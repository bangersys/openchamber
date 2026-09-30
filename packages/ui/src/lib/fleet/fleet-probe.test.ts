import { describe, expect, test } from 'bun:test';

import { probeFleetHost } from './fleet-probe';
import type { FleetHost } from './fleet-types';

const host = (overrides: Partial<FleetHost> = {}): FleetHost => ({
  id: 'h1',
  label: 'H1',
  apiUrl: 'https://fleet-1.example.com:3000',
  ...overrides,
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const withFetch = async (
  impl: (url: string) => Response | Promise<Response>,
  run: () => Promise<void>,
): Promise<void> => {
  const previous = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = (input: unknown) =>
    impl(String(typeof input === 'string' ? input : (input as URL).toString()));
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
};

const withAppVersion = async (version: string | undefined, run: () => Promise<void>): Promise<void> => {
  const key = '__APP_VERSION__';
  const previous = (globalThis as Record<string, unknown>)[key];
  (globalThis as Record<string, unknown>)[key] = version;
  try {
    await run();
  } finally {
    (globalThis as Record<string, unknown>)[key] = previous;
  }
};

describe('probeFleetHost', () => {
  test('unreachable health is offline, not auth', async () => {
    await withFetch(() => {
      throw new TypeError('fetch failed');
    }, async () => {
      const status = await probeFleetHost(host());
      expect(status.state).toBe('offline');
      expect(status.detail).toBe('network-error');
    });
  });

  test('non-ok health keeps the http code', async () => {
    await withFetch(() => new Response('bad gateway', { status: 502 }), async () => {
      const status = await probeFleetHost(host());
      expect(status.state).toBe('offline');
      expect(status.detail).toBe('http-502');
    });
  });

  test('missing version identity is incompatible, not offline', async () => {
    await withFetch((url) => {
      if (url.endsWith('/health')) return new Response('{}', { status: 200 });
      return new Response('nope', { status: 404 });
    }, async () => {
      const status = await probeFleetHost(host());
      expect(status.state).toBe('incompatible');
      expect(status.detail).toBe('unexpected-service');
    });
  });

  test('major version mismatch is incompatible', async () => {
    await withAppVersion('2.0.4', () =>
      withFetch((url) => {
        if (url.endsWith('/health')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/version')) return jsonResponse(200, { openchamberVersion: '3.1.0' });
        return new Response('{}', { status: 200 });
      }, async () => {
        const status = await probeFleetHost(host());
        expect(status.state).toBe('incompatible');
        expect(status.detail).toBe('version-mismatch');
        expect(status.serverVersion).toBe('3.1.0');
      }),
    );
  });

  test('401 on auth/session is auth, not offline', async () => {
    await withAppVersion('2.0.4', () =>
      withFetch((url) => {
        if (url.endsWith('/health')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/version')) return jsonResponse(200, { openchamberVersion: '2.0.4' });
        if (url.endsWith('/auth/session')) return new Response('unauthorized', { status: 401 });
        return new Response('{}', { status: 200 });
      }, async () => {
        const status = await probeFleetHost(host({ clientToken: 'wrong' }));
        expect(status.state).toBe('auth');
      }),
    );
  });

  test('healthy host is online with best-effort counts', async () => {
    await withAppVersion('2.0.4', () =>
      withFetch((url) => {
        if (url.endsWith('/health')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/version')) return jsonResponse(200, { openchamberVersion: '2.0.9' });
        if (url.endsWith('/auth/session')) return jsonResponse(200, { ok: true });
        if (url.endsWith('/api/sessions/status')) {
          return jsonResponse(200, {
            sessions: { a: { status: 'busy' }, b: { status: 'idle' } },
          });
        }
        return new Response('{}', { status: 404 });
      }, async () => {
        const status = await probeFleetHost(host({ clientToken: 'good' }));
        expect(status.state).toBe('online');
        expect(status.sessionTotal).toBe(2);
        expect(status.activeCount).toBe(1);
        expect(status.latencyMs).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  test('probe never throws on malformed bodies', async () => {
    await withFetch((url) => {
      if (url.endsWith('/health')) return new Response('{}', { status: 200 });
      return new Response('not-json{{{', { status: 200 });
    }, async () => {
      const status = await probeFleetHost(host());
      expect(['online', 'incompatible', 'unknown']).toContain(status.state);
    });
  });
});
