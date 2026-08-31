/**
 * core/obs/client — the thin obs REST + WebSocket transport (page-scoped auth).
 *
 * Mirrors the reference Visu (`frontend/src/api/client.ts`,
 * `frontend/src/composables/useWebSocket.ts`) in its v1 **page-scoped**
 * authorization model — there is no admin JWT login:
 *  - **public / readonly** pages need no auth at all; datapoint ops only carry an
 *    `X-Page-Id` header so the server can scope the request to that page.
 *  - **protected** pages use a PIN → session-token flow
 *    (`POST /visu/nodes/{id}/auth` → `{ session_token, expires_in }`); the token
 *    then rides along as `X-Session-Token` next to `X-Page-Id`.
 *  - **user** pages (real per-user JWT login) are NOT supported in v1 — the
 *    server answers 401 and this client surfaces it as {@link ObsAuthError} so the
 *    caller can treat the page as "not available" instead of crashing.
 *
 * Error taxonomy (kept apart so callers can react locally vs. globally):
 *  - 401 → {@link ObsAuthError}     (global: auth required / not available in v1)
 *  - 403 → {@link ObsForbiddenError} (local + still: this write is locked)
 *  - 404 → {@link ObsConcealedError} (a filtered/concealed datapoint → empty value)
 *
 * The WebSocket authenticates page-scoped via the query string
 * (`?page_id=&session_token=`) exactly like `useWebSocket.ts`; a `4001` close is
 * the server rejecting auth, so we do NOT reconnect on it (a plain reconnect
 * would loop). Uses only the platform `fetch` / `WebSocket`; an injectable
 * `fetch` and `WsLike` factory keep it unit-testable against mocks.
 */

import { getAccessToken, getRefreshToken, setTokens, clear } from './auth';

/* ------------------------------------------------------------------ config */

export interface ObsClientConfig {
  /** REST base, e.g. "/api/v1" (proxied) or "http://host:8080/api/v1". Default "/api/v1". */
  readonly apiBase?: string;
  /** WebSocket URL, e.g. "/api/v1/ws" (resolved against location) or absolute. */
  readonly wsUrl?: string;
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

/** Page-scoped auth context for the value WebSocket (query-string auth). */
export interface WsAuthContext {
  readonly pageId?: string | null;
  readonly sessionToken?: string | null;
}

/* ------------------------------------------------------------- error types */

/** 401 — auth required / not available in v1 (user pages). Handle globally. */
export class ObsAuthError extends Error {
  readonly status = 401;
  constructor(message = 'obs: unauthorized') {
    super(message);
    this.name = 'ObsAuthError';
  }
}

/** 403 — the caller may not write this datapoint. Handle locally + silently. */
export class ObsForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'obs: forbidden') {
    super(message);
    this.name = 'ObsForbiddenError';
  }
}

/** 404 — a filtered/concealed datapoint. Read yields an empty value, no crash. */
export class ObsConcealedError extends Error {
  readonly status = 404;
  constructor(message = 'obs: concealed') {
    super(message);
    this.name = 'ObsConcealedError';
  }
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
  private readonly doFetch: typeof fetch;
  private readonly makeWs: (url: string, protocols?: string | string[]) => WsLike;

  /** node id → held PIN session (token + absolute expiry ms). Protected pages only. */
  private readonly sessions = new Map<string, { token: string; expiresAt: number }>();

  constructor(config: ObsClientConfig = {}) {
    this.apiBase = config.apiBase ?? DEFAULT_API_BASE;
    this.wsUrl = resolveWsUrl(config.wsUrl);
    this.doFetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.makeWs =
      config.wsFactory ??
      ((url, protocols) => new WebSocket(url, protocols) as unknown as WsLike);
  }

  /* -------------------------------------------------------------- PIN auth */

  /**
   * Authenticate a protected node with its PIN. On success the session token is
   * cached under `nodeId` (respecting `expires_in`) and used for later
   * `X-Session-Token` headers automatically. A wrong PIN is a 401 → thrown as
   * {@link ObsAuthError} so the caller can show a PIN error without crashing.
   */
  async authenticatePin(
    nodeId: string,
    pin: string,
  ): Promise<{ sessionToken: string; expiresIn: number }> {
    const res = await this.doFetch(`${this.apiBase}/visu/nodes/${nodeId}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (res.status === 401) throw new ObsAuthError('obs: wrong PIN');
    if (!res.ok) throw new Error(`obs-datasource: PIN auth failed (HTTP ${res.status})`);
    const body = (await res.json()) as { session_token?: string; expires_in?: number };
    if (!body.session_token) throw new Error('obs-datasource: auth response had no session_token');
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.sessions.set(nodeId, {
      token: body.session_token,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    return { sessionToken: body.session_token, expiresIn };
  }

  /** The valid (non-expired) session token held for `nodeId`, or null. */
  sessionToken(nodeId: string): string | null {
    const s = this.sessions.get(nodeId);
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      this.sessions.delete(nodeId);
      return null;
    }
    return s.token;
  }

  /* -------------------------------------------------------------- REST */

  /** Build the page-scoped headers for a datapoint / writable request. */
  private pageHeaders(pageId?: string | null, sessionToken?: string | null): Record<string, string> {
    const headers: Record<string, string> = {};
    if (pageId) headers['X-Page-Id'] = pageId;
    const token = sessionToken ?? (pageId ? this.sessionToken(pageId) : null);
    if (token) headers['X-Session-Token'] = token;
    return headers;
  }

  /**
   * A JSON request with the page-scoped error taxonomy.
   *
   * Auth is **additive**: when a JWT is stored, every request carries
   * `Authorization: Bearer <access>` (coexisting with `X-Page-Id` /
   * `X-Session-Token`); without a token the request goes out exactly as a guest,
   * unchanged from before.
   *
   * A logged-in access-401 triggers a single silent recovery: try
   * {@link ObsClient.refresh}; on success replay the request once with the fresh
   * token; on failure drop to guest ({@link ObsClient.logout}) and replay once
   * without a token — so a public read keeps working and there is no crash / no
   * forced global logout. Only if the guest replay itself 401s does the typed
   * {@link ObsAuthError} surface, identical to today's guest behavior. 403/404
   * stay local + silent as before.
   */
  private async request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    const access = getAccessToken();
    if (access) headers['Authorization'] = `Bearer ${access}`;
    const res = await this.doFetch(`${this.apiBase}${path}`, { ...init, headers });

    if (res.status === 401) {
      // Recover a logged-in 401 once: refresh → replay, else guest → replay.
      if (allowRefresh && access) {
        if (await this.refresh()) return this.request<T>(path, init, false);
        this.logout();
        return this.request<T>(path, init, false);
      }
      throw new ObsAuthError(`obs: ${init.method ?? 'GET'} ${path} unauthorized`);
    }
    if (res.status === 403) throw new ObsForbiddenError(`obs: ${init.method ?? 'GET'} ${path} forbidden`);
    if (res.status === 404) throw new ObsConcealedError(`obs: ${path} concealed`);
    if (!res.ok) {
      throw new Error(`obs-datasource: ${init.method ?? 'GET'} ${path} failed (HTTP ${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /* -------------------------------------------------------------- JWT login */

  /**
   * `POST /auth/login` ({@link LoginRequest} `{username, password}`) → store the
   * `{access_token, refresh_token}` pair. Unlocks per-user RBAC for later
   * requests. A wrong credential is a 401 → {@link ObsAuthError} so the login
   * form can show it; guests never need this.
   */
  async login(username: string, password: string): Promise<void> {
    const res = await this.doFetch(`${this.apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.status === 401) throw new ObsAuthError('obs: invalid credentials');
    if (!res.ok) throw new Error(`obs: login failed (HTTP ${res.status})`);
    const body = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!body.access_token) throw new Error('obs: login response had no access_token');
    setTokens(body.access_token, body.refresh_token ?? null);
  }

  /**
   * `POST /auth/refresh` (`{refresh_token}`) → store the new tokens. Runs silently
   * in the background on an access-401; never throws and never routes through
   * {@link ObsClient.request} (which would recurse on 401). Returns whether a
   * fresh access token was obtained; a missing/invalid refresh token yields false
   * so the caller falls back to guest.
   */
  async refresh(): Promise<boolean> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await this.doFetch(`${this.apiBase}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { access_token?: string; refresh_token?: string };
      if (!body.access_token) return false;
      setTokens(body.access_token, body.refresh_token ?? null);
      return true;
    } catch {
      return false;
    }
  }

  /** Drop the stored JWT → back to guest. Page-scoped / PIN paths are untouched. */
  logout(): void {
    clear();
  }

  /** GET /visu/tree — the (server-filtered) visu node tree (flat list). Public read. */
  getVisuTree<T>(): Promise<T> {
    return this.request<T>('/visu/tree');
  }

  /**
   * POST /visu/nodes/{pageId}/writable — the per-datapoint writability verdict
   * for the datapoints placed on a page, computed with the same authorization
   * the real write path enforces. Page-scoped (`X-Page-Id` + optional
   * `X-Session-Token`); readonly pages yield an all-false map server-side.
   */
  getWritable(pageId: string, sessionToken?: string | null): Promise<Record<string, boolean>> {
    return this.request<{ writable?: Record<string, boolean> }>(
      `/visu/nodes/${pageId}/writable`,
      { method: 'POST', headers: this.pageHeaders(pageId, sessionToken) },
    ).then((r) => r.writable ?? {});
  }

  /** GET /datapoints/{id}/value — one datapoint's current value (page-scoped). */
  getValue(
    id: string,
    pageId?: string | null,
    sessionToken?: string | null,
  ): Promise<{ value: unknown; unit?: string | null }> {
    return this.request(`/datapoints/${id}/value`, { headers: this.pageHeaders(pageId, sessionToken) });
  }

  /**
   * POST /datapoints/{id}/value — write a value (page-scoped). A 403 becomes
   * {@link ObsForbiddenError} so the caller can treat the control as locked
   * without surfacing an error.
   */
  writeValue(
    id: string,
    value: unknown,
    pageId?: string | null,
    sessionToken?: string | null,
  ): Promise<void> {
    return this.request<void>(`/datapoints/${id}/value`, {
      method: 'POST',
      headers: this.pageHeaders(pageId, sessionToken),
      body: JSON.stringify({ value }),
    });
  }

  /* ---------------------------------------------------------- WebSocket */

  /**
   * Open the value-event WebSocket. `onValue` receives each `{id,v,…}` event;
   * the socket auto-reconnects with backoff and re-subscribes the current id set.
   * `getContext` (optional) supplies the page-scoped auth for the query string on
   * every (re)connect. A `4001` close (auth rejected) stops reconnecting.
   */
  openWebSocket(
    onValue: (ev: ObsValueEvent) => void,
    getContext?: () => WsAuthContext,
  ): WsHandle {
    return new WsHandle(this.wsUrl, this.makeWs, onValue, getContext);
  }
}

/* ------------------------------------------------------------- WS handle */

/**
 * A self-reconnecting WebSocket subscription. Buffers the subscribed id set so a
 * (re)connect re-sends it, exactly as the reference `useWebSocket.ts` does. Auth
 * is page-scoped via the query string; a `4001` close disables reconnection.
 */
export class WsHandle {
  private socket: WsLike | null = null;
  private readonly ids = new Set<string>();
  private closed = false;
  /** Set once the server rejects auth (close 4001) — reconnect stays disabled. */
  private authRejected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private static readonly MAX_DELAY = 30_000;

  constructor(
    private readonly wsUrl: string,
    private readonly makeWs: (url: string, protocols?: string | string[]) => WsLike,
    private readonly onValue: (ev: ObsValueEvent) => void,
    private readonly getContext?: () => WsAuthContext,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed || this.socket || this.authRejected) return;

    const ctx = this.getContext?.() ?? {};
    let url = this.wsUrl;
    const params = new URLSearchParams();
    if (ctx.pageId) {
      params.set('page_id', ctx.pageId);
      if (ctx.sessionToken) params.set('session_token', ctx.sessionToken);
    }
    const qs = params.toString();
    if (qs) url = `${url}${url.includes('?') ? '&' : '?'}${qs}`;

    const ws = this.makeWs(url);
    this.socket = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      // Subscribe the full id set; the server delivers only the allowed scope
      // (subscribe-intersection) — events for revoked DPs simply stop arriving.
      if (this.ids.size > 0) this.sendSubscribe([...this.ids]);
    };
    ws.onclose = (ev) => {
      this.socket = null;
      if (this.closed) return;
      // 4001 = auth rejected by the server; reconnecting would loop, so stop.
      if (ev?.code === 4001) {
        this.authRejected = true;
        return;
      }
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
    if (this.reconnectTimer || this.closed || this.authRejected) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, WsHandle.MAX_DELAY);
      this.connect();
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
