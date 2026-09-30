import { z } from 'zod';

import type { FleetHost, FleetTileStatus } from './fleet-types';

declare const __APP_VERSION__: string | undefined;

/** Per-request budget. The store enforces this with an AbortController. */
export const FLEET_PROBE_TIMEOUT_MS = 8_000;

// Payloads are parsed at the boundary with narrow schemas: a malformed body
// is untrusted input, never a status. Only the fields the tile needs are
// read; zod drops the rest.
const versionPayloadSchema = z
  .object({
    openchamberVersion: z.string().optional(),
  })
  .catchall(z.unknown());

const sessionsPayloadSchema = z
  .object({
    sessions: z
      .record(
        z.string(),
        z.object({ status: z.string().optional() }).catchall(z.unknown()),
      )
      .optional(),
  })
  .catchall(z.unknown());

// Same ngrok match as `addRuntimeProxyHeaders` in `runtime-fetch.ts` (which
// does not export it): ngrok's browser-warning interstitial breaks API reads,
// so ngrok hosts get the skip header.
const isNgrokHostname = (hostname: string): boolean =>
  /(^|\.)ngrok(?:-free)?\.(?:app|dev|io)$/i.test(hostname);

const majorOf = (version: string): string | null => {
  const part = version.trim().replace(/^v/i, '').split(/[.\-+]/)[0];
  return part ? part : null;
};

const readLocalMajor = (): string | null => {
  try {
    const raw = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined;
    if (!raw) return null;
    return majorOf(raw);
  } catch {
    return null;
  }
};

const buildProbeHeaders = (host: FleetHost, url: string): Headers => {
  const headers = new Headers({ Accept: 'application/json' });
  for (const [name, value] of Object.entries(host.requestHeaders ?? {})) {
    if (name.trim().toLowerCase() === 'authorization') continue;
    headers.set(name, value);
  }
  const token = host.clientToken?.trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    if (isNgrokHostname(new URL(url).hostname) && !headers.has('ngrok-skip-browser-warning')) {
      headers.set('ngrok-skip-browser-warning', 'openchamber');
    }
  } catch {
    // Base URLs are validated on store entry; a relative join cannot happen.
  }
  return headers;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';

/**
 * Lightweight status probe for one fleet host. Pure: no store reads, no
 * active-runtime globals — plain `fetch` against the host's own `apiUrl`, so
 * tiles never disturb the single active runtime.
 *
 * Order is deliberate: unauthenticated `/health` first (reachability), then
 * `/api/version` (identity before interpreting auth), then `/auth/session`
 * with the bearer (401/403 means the token is wrong, not that the host is
 * down), then the best-effort session counts. A version endpoint that answers
 * 404, or answers 200 without OpenChamber identity, means this address is not
 * an OpenChamber server: `incompatible`, not `offline`.
 *
 * This function never throws: every failure mode becomes a status. The store
 * additionally guards the call, and a throw there preserves last-known state.
 */
export const probeFleetHost = async (
  host: FleetHost,
  signal?: AbortSignal,
): Promise<FleetTileStatus> => {
  const startedAt = Date.now();
  const finish = (status: FleetTileStatus): FleetTileStatus => ({
    ...status,
    latencyMs: Math.max(0, Date.now() - startedAt),
    checkedAt: Date.now(),
  });
  const base = host.apiUrl.replace(/\/+$/, '');
  const join = (path: string): string => `${base}${path}`;
  const headers = buildProbeHeaders(host, base);

  try {
    const health = await fetch(join('/health'), { headers, signal });
    if (!health.ok) {
      return finish({ state: 'offline', detail: `http-${health.status}` });
    }
  } catch (error) {
    return finish({ state: 'offline', detail: isAbortError(error) ? 'aborted' : 'network-error' });
  }

  let serverVersion: string | undefined;
  try {
    const response = await fetch(join('/api/version'), { headers, signal });
    if (response.status === 404) {
      return finish({ state: 'incompatible', detail: 'unexpected-service' });
    }
    if (response.ok) {
      const parsed = versionPayloadSchema.safeParse(await response.json().catch(() => null));
      const version = parsed.success ? parsed.data.openchamberVersion?.trim() : undefined;
      if (version) {
        serverVersion = version;
      } else {
        return finish({ state: 'incompatible', detail: 'unexpected-service' });
      }
    }
    // Other failures are best-effort: identity stays unknown, probe continues.
  } catch (error) {
    if (isAbortError(error) && signal?.aborted) {
      return finish({ state: 'offline', serverVersion, detail: 'aborted' });
    }
    // Best-effort: continue without server identity.
  }

  const localMajor = readLocalMajor();
  const remoteMajor = serverVersion ? majorOf(serverVersion) : null;
  if (serverVersion && localMajor && remoteMajor && remoteMajor !== localMajor) {
    return finish({ state: 'incompatible', serverVersion, detail: 'version-mismatch' });
  }

  try {
    const session = await fetch(join('/auth/session'), { headers, signal });
    if (session.status === 401 || session.status === 403) {
      return finish({ state: 'auth', serverVersion, detail: `http-${session.status}` });
    }
    if (session.status === 404) {
      return finish({ state: 'incompatible', serverVersion, detail: 'unexpected-service' });
    }
    if (!session.ok) {
      return finish({ state: 'unknown', serverVersion, detail: `http-${session.status}` });
    }
  } catch (error) {
    return finish({
      state: 'offline',
      serverVersion,
      detail: isAbortError(error) ? 'aborted' : 'network-error',
    });
  }

  let sessionTotal: number | undefined;
  let activeCount: number | undefined;
  try {
    const response = await fetch(join('/api/sessions/status'), { headers, signal });
    if (response.ok) {
      const parsed = sessionsPayloadSchema.safeParse(await response.json().catch(() => null));
      const sessions = parsed.success ? parsed.data.sessions : undefined;
      if (sessions) {
        const ids = Object.keys(sessions);
        sessionTotal = ids.length;
        activeCount = ids.filter((id) => {
          const status = sessions[id]?.status;
          return status === 'busy' || status === 'retry';
        }).length;
      }
    }
    // Counts are coverage, not truth: absence never fails the tile.
  } catch {
    // Best-effort: the host is online, counts stay unknown.
  }

  return finish({
    state: 'online',
    ...(serverVersion ? { serverVersion } : {}),
    ...(sessionTotal !== undefined ? { sessionTotal } : {}),
    ...(activeCount !== undefined ? { activeCount } : {}),
  });
};
