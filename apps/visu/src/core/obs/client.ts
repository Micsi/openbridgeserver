/**
 * core/obs/client — the thin obs REST + WebSocket transport.
 *
 * Mirrors the reference Visu (`frontend/src/api/client.ts`,
 * `frontend/src/composables/useWebSocket.ts`):
 *  - JWT login at `POST /api/v1/auth/login` (default admin/admin), Bearer in
 *    every REST request; on 401 it logs in again once and retries (the obs
 *    backend hands out short-lived tokens — re-login is the refresh path).
 *  - WebSocket at `/api/v1/ws` authenticated via the `obs.jwt.<token>`
 *    subprotocol (exactly as `useWebSocket.ts` does), with `{action:"subscribe",
 *    ids:[…]}` messages and `{id,v,u,t,q}` value-events, plus reconnect/backoff.
 *
 * Uses only the platform `fetch` / `WebSocket` — no new dependency. A `WsLike`
 * factory and an injectable `fetch` keep it unit-testable against mocks.
 */

/* ------------------------------------------------------------------ config */

export interface ObsClientConfig {
  /** REST base, e.g. "/api/v1" (proxied) or "http://host:8080/api/v1". Default "/api/v1". */
  readonly apiBase?: string;
  /** WebSocket URL, e.g. "/api/v1/ws" (resolved against location) or absolute. */
  readonly wsUrl?: string;
  readonly username?: string;
  readonly password?: string;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable WebSocket constructor for tests; defaults to global WebSocket. */
  readonly wsFactory?: (url: string, protocols?: string | string[]) => WsLike;
}

/** The minimal WebSocket surface the client uses (so tests can supply a fake). */
export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}

/** A normalised value-event (obs/api/v1/websocket.py server→client shape). */
export interface ObsValueEvent {
  readonly id: string;
  readonly v: unknown;
  readonly u?: string | null;
  readonly t?: string | null;
  readonly q?: string;
}

const DEFAULT_API_BASE = '/api/v1';
const DEFAULT_WS_PATH = '/api/v1/ws';

/** Resolve a possibly-relative WS path against the browser location → ws(s)://. */
function resolveWsUrl(wsUrl: string | undefined): string {
  const path = wsUrl ?? DEFAULT_WS_PATH;
  if (/^wss?:\/\//.test(path)) return path;
  // Relative: resolve against location (matches frontend useWebSocket WS_URL()).
  if (typeof location !== 'undefined') {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}${path}`;
  }
  return path;
}

/* ------------------------------------------------------------------ client */

export class ObsClient {
  private readonly apiBase: string;
  private readonly wsUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly doFetch: typeof fetch;
  private readonly makeWs: (url: string, protocols?: string | string[]) => WsLike;

  private token: string | null = null;
  /** De-duplicates concurrent logins into one in-flight request. */
  private loginInFlight: Promise<string> | null = null;

  constructor(config: ObsClientConfig = {}) {
    this.apiBase = config.apiBase ?? DEFAULT_API_BASE;
    this.wsUrl = resolveWsUrl(config.wsUrl);
    this.username = config.username ?? 'admin';
    this.password = config.password ?? 'admin';
    this.doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.makeWs =
      config.wsFactory ??
      ((url, protocols) => new WebSocket(url, protocols) as unknown as WsLike);
  }

  /* -------------------------------------------------------------- auth */

  /** Ensure a JWT is held, logging in if necessary. Concurrent calls share one login. */
  async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    return this.login();
  }

  /** Current token (may be null before the first login). For WS subprotocol use. */
  get currentToken(): string | null {
    return this.token;
  }

  private login(): Promise<string> {
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = (async () => {
      const res = await this.doFetch(`${this.apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
      if (!res.ok) {
        throw new Error(`obs-datasource: login failed (HTTP ${res.status})`);
      }
      const body = (await res.json()) as { access_token?: string };
      if (!body.access_token) throw new Error('obs-datasource: login response had no token');
      this.token = body.access_token;
      return this.token;
    })();
    try {
      return this.loginInFlight;
    } finally {
      // Clear the in-flight handle once it settles (success or failure) so a
      // later expiry can trigger a fresh login.
      void this.loginInFlight.finally(() => {
        this.loginInFlight = null;
      });
    }
  }

  /* -------------------------------------------------------------- REST */

  /** Authenticated JSON request with a single 401-driven re-login + retry. */
  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await this.ensureToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    };
    const res = await this.doFetch(`${this.apiBase}${path}`, { ...init, headers });

    if (res.status === 401 && retry) {
      // Token expired/invalid → drop it, log in afresh, retry once (refresh path).
      this.token = null;
      return this.request<T>(path, init, false);
    }
    if (!res.ok) {
      throw new Error(`obs-datasource: ${init.method ?? 'GET'} ${path} failed (HTTP ${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** GET /visu/tree — the whole visu node tree (flat list). */
  getVisuTree<T>(): Promise<T> {
    return this.request<T>('/visu/tree');
  }

  /** GET /datapoints/{id}/value — one datapoint's current value. */
  getValue(id: string): Promise<{ value: unknown; unit?: string | null }> {
    return this.request(`/datapoints/${id}/value`);
  }

  /** POST /datapoints/{id}/value — write a value (KNX etc. via the WriteRouter). */
  writeValue(id: string, value: unknown): Promise<void> {
    return this.request<void>(`/datapoints/${id}/value`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    });
  }

  /* ---------------------------------------------------------- WebSocket */

  /**
   * Open the value-event WebSocket. `onValue` receives each `{id,v,…}` event;
   * the socket auto-reconnects with backoff and re-subscribes the current id set
   * (mirrors useWebSocket.ts). Returns a handle to (re)subscribe and to close.
   */
  openWebSocket(onValue: (ev: ObsValueEvent) => void): WsHandle {
    return new WsHandle(
      () => this.ensureToken(),
      this.wsUrl,
      this.makeWs,
      onValue,
    );
  }
}

/* ------------------------------------------------------------- WS handle */

/**
 * A self-reconnecting WebSocket subscription. Buffers the subscribed id set so a
 * (re)connect re-sends it, exactly as the reference `useWebSocket.ts` does.
 */
export class WsHandle {
  private socket: WsLike | null = null;
  private readonly ids = new Set<string>();
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private static readonly MAX_DELAY = 30_000;

  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly wsUrl: string,
    private readonly makeWs: (url: string, protocols?: string | string[]) => WsLike,
    private readonly onValue: (ev: ObsValueEvent) => void,
  ) {
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closed || this.socket) return;
    let token: string;
    try {
      token = await this.getToken();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.closed) return;

    const ws = this.makeWs(this.wsUrl, [`obs.jwt.${token}`]);
    this.socket = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      if (this.ids.size > 0) this.sendSubscribe([...this.ids]);
    };
    ws.onclose = (ev) => {
      this.socket = null;
      if (this.closed) return;
      // 4001 = auth rejected by the server; a plain reconnect would loop, so
      // drop the token first and reconnect (forces a fresh login).
      if (ev?.code === 4001) this.reconnectDelay = 1000;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      ws.close();
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (data && typeof data === 'object' && 'id' in data && 'v' in data) {
        this.onValue(data as ObsValueEvent);
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, WsHandle.MAX_DELAY);
      void this.connect();
    }, this.reconnectDelay);
  }

  private sendSubscribe(ids: string[]): void {
    if (this.socket) this.socket.send(JSON.stringify({ action: 'subscribe', ids }));
  }

  /** Add datapoint ids to the subscription (buffered + sent if connected). */
  subscribe(ids: readonly string[]): void {
    const fresh = ids.filter((id) => !this.ids.has(id));
    for (const id of fresh) this.ids.add(id);
    if (fresh.length > 0) this.sendSubscribe(fresh);
  }

  /** Close the socket and stop reconnecting. */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}
