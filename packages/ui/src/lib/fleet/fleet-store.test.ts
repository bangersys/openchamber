import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { FLEET_HOSTS_STORAGE_KEY } from './fleet-store';
import type { FleetHost } from './fleet-types';

const importFleetStore = async (): Promise<typeof import('./fleet-store')> =>
  import(`./fleet-store.ts?test=${Date.now()}-${Math.random()}`);

const createFakeStorage = (): Storage & { writes: number } => {
  const store = new Map<string, string>();
  const storage = {
    writes: 0,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.writes += 1;
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  return storage;
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let previousFetch: typeof globalThis.fetch;
let previousStorage: unknown;

beforeEach(() => {
  previousFetch = globalThis.fetch;
  previousStorage = (globalThis as Record<string, unknown>).localStorage;
  (globalThis as Record<string, unknown>).localStorage = createFakeStorage();
});

afterEach(() => {
  globalThis.fetch = previousFetch;
  (globalThis as Record<string, unknown>).localStorage = previousStorage;
});

const readStored = (): { version: number; hosts: FleetHost[] } | null => {
  const storage = (globalThis as Record<string, unknown>).localStorage as Storage;
  const raw = storage.getItem(FLEET_HOSTS_STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as { version: number; hosts: FleetHost[] };
};

describe('useFleetStore', () => {
  test('malformed persisted envelope loads empty instead of crashing', async () => {
    const storage = (globalThis as Record<string, unknown>).localStorage as Storage;
    storage.setItem(FLEET_HOSTS_STORAGE_KEY, 'not-json{{{');
    const { useFleetStore } = await importFleetStore();
    expect(useFleetStore.getState().hosts).toEqual([]);
  });

  test('addHost validates, dedupes by url, and persists a hosts-only envelope', async () => {
    const { useFleetStore } = await importFleetStore();
    expect(() => useFleetStore.getState().addHost({ label: 'x', apiUrl: 'not a url' })).toThrow(
      'invalid-api-url',
    );
    const id = useFleetStore
      .getState()
      .addHost({ label: 'One', apiUrl: 'https://fleet-1.example.com:3000/' });
    const same = useFleetStore
      .getState()
      .addHost({ label: 'One again', apiUrl: 'https://fleet-1.example.com:3000' });
    expect(same).toBe(id);
    expect(useFleetStore.getState().hosts).toHaveLength(1);
    const stored = readStored();
    expect(stored?.version).toBe(1);
    expect(stored?.hosts).toHaveLength(1);
    expect(stored?.hosts[0]?.apiUrl).toBe('https://fleet-1.example.com:3000/');
    expect(Object.keys(stored ?? {}).sort()).toEqual(['hosts', 'version']);
  });

  test('importFromDesktopHosts skips relay-only hosts and known urls', async () => {
    const { useFleetStore } = await importFleetStore();
    const added = useFleetStore.getState().importFromDesktopHosts([
      {
        id: 'relay-only',
        label: 'Relay',
        url: 'relay://abc',
        relay: {
          relayUrl: 'https://relay.example.com',
          serverId: 'abc',
          hostEncPubJwk: { kty: 'OKP' },
        },
      },
      { id: 'direct', label: 'Direct', url: 'https://direct.example.com', apiUrl: 'https://direct.example.com' },
    ]);
    expect(added).toBe(1);
    expect(useFleetStore.getState().hosts.map((host) => host.id)).toEqual(['direct']);
    const addedAgain = useFleetStore.getState().importFromDesktopHosts([
      { id: 'direct-2', label: 'Direct', url: 'https://direct.example.com', apiUrl: 'https://direct.example.com' },
    ]);
    expect(addedAgain).toBe(0);
  });

  test('removeHost drops status and a late probe never resurrects it', async () => {
    globalThis.fetch = () => Promise.resolve(jsonResponse(200, {}));
    const { useFleetStore } = await importFleetStore();
    const id = useFleetStore.getState().addHost({ label: 'One', apiUrl: 'https://fleet-1.example.com' });
    await useFleetStore.getState().refreshHost(id);
    expect(useFleetStore.getState().statuses[id]).toBeDefined();
    // A newer generation (from a second refresh) lands first; the older
    // in-flight probe must not overwrite it afterwards. The gate object (not
    // a narrowed local) carries the deferred release across the awaits.
    const gate: { release: ((response: Response) => void) | null } = { release: null };
    let calls = 0;
    globalThis.fetch = () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Response>((resolve) => {
          gate.release = resolve;
        });
      }
      return Promise.resolve(jsonResponse(200, {}));
    };
    const older = useFleetStore.getState().refreshHost(id);
    await useFleetStore.getState().refreshHost(id);
    gate.release?.(jsonResponse(200, {}));
    await older;
    useFleetStore.getState().removeHost(id);
    expect(useFleetStore.getState().hosts).toEqual([]);
    expect(useFleetStore.getState().statuses[id]).toBeUndefined();
  });

  test('probe commits do not rewrite persisted storage', async () => {
    globalThis.fetch = (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/health')) return Promise.resolve(new Response('{}', { status: 200 }));
      if (url.endsWith('/api/version')) {
        return Promise.resolve(jsonResponse(200, { openchamberVersion: '9.9.9' }));
      }
      if (url.endsWith('/auth/session')) return Promise.resolve(jsonResponse(200, { ok: true }));
      if (url.endsWith('/api/sessions/status')) {
        return Promise.resolve(jsonResponse(200, { sessions: { a: { status: 'busy' } } }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    };
    const { useFleetStore } = await importFleetStore();
    useFleetStore.getState().addHost({ label: 'One', apiUrl: 'https://fleet-1.example.com' });
    const storage = (globalThis as Record<string, unknown>).localStorage as Storage & { writes: number };
    const writesAfterAdd = storage.writes;
    await useFleetStore.getState().refreshAll();
    expect(useFleetStore.getState().statuses).not.toEqual({});
    expect(storage.writes).toBe(writesAfterAdd);
  });
});
