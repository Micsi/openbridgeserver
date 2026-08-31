import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAccessToken, getRefreshToken, setTokens, clear } from './auth';
import { ObsClient, ObsAuthError } from './client';

/* ---------------------------------------------------------------- test doubles */

interface FakeResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

function jsonRes(status: number, body: unknown = null): FakeResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

/** A programmable fetch: replies are dequeued FIFO; every call is recorded. */
class FetchMock {
  readonly calls: { url: string; init: RequestInit }[] = [];
  private readonly queue: ((url: string, init: RequestInit) => FakeResponse)[] = [];

  reply(fn: (url: string, init: RequestInit) => FakeResponse): this {
    this.queue.push(fn);
    return this;
  }

  readonly fetch = ((url: string, init: RequestInit = {}) => {
    this.calls.push({ url, init });
    const h = this.queue.shift();
    if (!h) throw new Error(`unexpected fetch: ${url}`);
    return Promise.resolve(h(url, init)) as unknown as Promise<Response>;
  }) as unknown as typeof fetch;

  authOf(i: number): string | undefined {
    return (this.calls[i]?.init.headers as Record<string, string> | undefined)?.['Authorization'];
  }
}

function makeClient(fetchMock: FetchMock): ObsClient {
  return new ObsClient({ fetchImpl: fetchMock.fetch, apiBase: '/api/v1' });
}

/** A working in-memory localStorage (the jsdom default here lacks methods). */
function installStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ token store */

describe('auth token store', () => {
  it('setTokens stores access + refresh; getters read them back', () => {
    setTokens('acc', 'ref');
    expect(getAccessToken()).toBe('acc');
    expect(getRefreshToken()).toBe('ref');
    expect(localStorage.getItem('visu_jwt')).toBe('acc');
    expect(localStorage.getItem('visu_refresh')).toBe('ref');
  });

  it('setTokens without a refresh token leaves the refresh slot empty', () => {
    setTokens('acc-only');
    expect(getAccessToken()).toBe('acc-only');
    expect(getRefreshToken()).toBeNull();
  });

  it('clear() removes both tokens → back to guest', () => {
    setTokens('acc', 'ref');
    clear();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('guest by default: empty storage yields null', () => {
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('broken localStorage degrades to guest without crashing', () => {
    const boom = () => {
      throw new Error('storage disabled');
    };
    vi.stubGlobal('localStorage', {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
      clear: boom,
    });

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(() => setTokens('a', 'b')).not.toThrow();
    expect(() => clear()).not.toThrow();
  });
});

/* --------------------------------------------------------------- login / logout */

describe('ObsClient.login / logout', () => {
  it('login stores access + refresh and later requests send Bearer', async () => {
    const f = new FetchMock()
      .reply(() => jsonRes(200, { access_token: 'A', refresh_token: 'R' }))
      .reply(() => jsonRes(200, []));
    const client = makeClient(f);

    await client.login('resident', 'secret');
    expect(getAccessToken()).toBe('A');
    expect(getRefreshToken()).toBe('R');
    expect(f.calls[0].url).toBe('/api/v1/auth/login');
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
      username: 'resident',
      password: 'secret',
    });

    await client.getVisuTree();
    expect(f.authOf(1)).toBe('Bearer A');
  });

  it('guest (no token) sends no Authorization header', async () => {
    const f = new FetchMock().reply(() => jsonRes(200, []));
    await makeClient(f).getVisuTree();
    expect(f.authOf(0)).toBeUndefined();
  });

  it('wrong credentials (401) throw ObsAuthError and store nothing', async () => {
    const f = new FetchMock().reply(() => jsonRes(401));
    await expect(makeClient(f).login('x', 'bad')).rejects.toBeInstanceOf(ObsAuthError);
    expect(getAccessToken()).toBeNull();
  });

  it('a non-401 login failure throws a generic error', async () => {
    const f = new FetchMock().reply(() => jsonRes(500));
    await expect(makeClient(f).login('x', 'y')).rejects.toThrow(/login failed/);
  });

  it('a login response without an access token throws', async () => {
    const f = new FetchMock().reply(() => jsonRes(200, { refresh_token: 'R' }));
    await expect(makeClient(f).login('x', 'y')).rejects.toThrow(/no access_token/);
  });

  it('a login response without a refresh token stores only the access token', async () => {
    const f = new FetchMock().reply(() => jsonRes(200, { access_token: 'A' }));
    await makeClient(f).login('x', 'y');
    expect(getAccessToken()).toBe('A');
    expect(getRefreshToken()).toBeNull();
  });

  it('logout() clears the tokens → guest again', async () => {
    setTokens('A', 'R');
    const f = new FetchMock().reply(() => jsonRes(200, []));
    const client = makeClient(f);
    client.logout();
    expect(getAccessToken()).toBeNull();

    await client.getVisuTree();
    expect(f.authOf(0)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------- refresh() */

describe('ObsClient.refresh', () => {
  it('returns false when there is no refresh token', async () => {
    const f = new FetchMock();
    expect(await makeClient(f).refresh()).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it('POSTs the refresh token and stores the new access on success', async () => {
    setTokens('old', 'R');
    const f = new FetchMock().reply(() => jsonRes(200, { access_token: 'new', refresh_token: 'R2' }));
    const ok = await makeClient(f).refresh();
    expect(ok).toBe(true);
    expect(f.calls[0].url).toBe('/api/v1/auth/refresh');
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ refresh_token: 'R' });
    expect(getAccessToken()).toBe('new');
    expect(getRefreshToken()).toBe('R2');
  });

  it('keeps the existing refresh token when the response omits a new one', async () => {
    setTokens('old', 'R');
    const f = new FetchMock().reply(() => jsonRes(200, { access_token: 'new' }));
    expect(await makeClient(f).refresh()).toBe(true);
    expect(getAccessToken()).toBe('new');
    expect(getRefreshToken()).toBe('R');
  });

  it('returns false on a non-ok refresh response', async () => {
    setTokens('old', 'R');
    const f = new FetchMock().reply(() => jsonRes(401));
    expect(await makeClient(f).refresh()).toBe(false);
  });

  it('returns false when the refresh response omits the access token', async () => {
    setTokens('old', 'R');
    const f = new FetchMock().reply(() => jsonRes(200, {}));
    expect(await makeClient(f).refresh()).toBe(false);
  });

  it('returns false when the network throws', async () => {
    setTokens('old', 'R');
    const f = new FetchMock().reply(() => {
      throw new Error('network down');
    });
    expect(await makeClient(f).refresh()).toBe(false);
  });
});

/* --------------------------------------------------------- 401 → refresh → guest */

describe('ObsClient access-401 recovery', () => {
  it('refresh success → replays the request with the fresh token', async () => {
    setTokens('A', 'R');
    const f = new FetchMock()
      .reply(() => jsonRes(401)) // /visu/tree with stale token
      .reply(() => jsonRes(200, { access_token: 'A2', refresh_token: 'R2' })) // /auth/refresh
      .reply(() => jsonRes(200, ['ok'])); // /visu/tree replay
    const client = makeClient(f);

    const tree = await client.getVisuTree<string[]>();
    expect(tree).toEqual(['ok']);
    expect(f.authOf(0)).toBe('Bearer A'); // first try used the stale token
    expect(f.calls[1].url).toBe('/api/v1/auth/refresh');
    expect(f.authOf(2)).toBe('Bearer A2'); // replay used the refreshed token
    expect(getAccessToken()).toBe('A2');
  });

  it('refresh failure → clears to guest and replays; a public read still works, no throw', async () => {
    setTokens('A', 'R');
    const f = new FetchMock()
      .reply(() => jsonRes(401)) // /visu/tree with token
      .reply(() => jsonRes(401)) // /auth/refresh fails
      .reply(() => jsonRes(200, ['public'])); // guest replay succeeds
    const client = makeClient(f);

    const tree = await client.getVisuTree<string[]>();
    expect(tree).toEqual(['public']);
    expect(getAccessToken()).toBeNull(); // dropped to guest
    expect(f.authOf(2)).toBeUndefined(); // guest replay carried no Authorization
  });

  it('guest 401 (no token) throws ObsAuthError, unchanged from before', async () => {
    const f = new FetchMock().reply(() => jsonRes(401));
    await expect(makeClient(f).getVisuTree()).rejects.toBeInstanceOf(ObsAuthError);
  });

  it('if even the guest replay is unauthorized, ObsAuthError surfaces', async () => {
    setTokens('A', 'R');
    const f = new FetchMock()
      .reply(() => jsonRes(401)) // token request
      .reply(() => jsonRes(401)) // refresh fails
      .reply(() => jsonRes(401)); // guest replay also unauthorized
    await expect(makeClient(f).getVisuTree()).rejects.toBeInstanceOf(ObsAuthError);
    expect(getAccessToken()).toBeNull();
  });
});
