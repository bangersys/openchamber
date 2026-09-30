import { z } from 'zod';
import { create } from 'zustand';

import { normalizeHostUrl, type DesktopHost } from '../desktopHosts';
import { switchRuntimeEndpoint } from '../runtime-switch';
import { FLEET_PROBE_TIMEOUT_MS, probeFleetHost } from './fleet-probe';
import type { FleetHost, FleetHostId, FleetTileStatus } from './fleet-types';

export const FLEET_HOSTS_STORAGE_KEY = 'openchamber-fleet-hosts';
export const FLEET_HOSTS_STORAGE_VERSION = 1;
/** Tile refresh cadence while the fleet view is visible. Hidden = no work. */
export const FLEET_POLL_INTERVAL_MS = 30_000;
/** Max simultaneous host probes per poll pass. */
export const FLEET_POLL_CONCURRENCY = 4;

// Persisted hosts are untrusted input (shared localStorage across builds):
// narrow construction at the boundary, malformed entries dropped, a malformed
// envelope means empty — never a crash.
// WebCrypto JsonWebKey fields the relay trust anchor uses. Unknown members
// are still accepted at parse time (catchall) and passed through at runtime;
// the named fields are what make the inferred type assignable without a cast.
const jsonWebKeySchema = z
  .object({
    kty: z.string().min(1),
    alg: z.string().optional(),
    crv: z.string().optional(),
    d: z.string().optional(),
    e: z.string().optional(),
    ext: z.boolean().optional(),
    k: z.string().optional(),
    key_ops: z.array(z.string()).optional(),
    n: z.string().optional(),
    use: z.string().optional(),
    x: z.string().optional(),
    y: z.string().optional(),
  })
  .catchall(z.unknown());

const fleetRelaySchema = z
  .object({
    relayUrl: z.string().min(1),
    serverId: z.string().min(1),
    hostEncPubJwk: jsonWebKeySchema,
  })
  .catchall(z.unknown());

const fleetHostSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    apiUrl: z.string().min(1),
    clientToken: z.string().optional(),
    requestHeaders: z.record(z.string(), z.string()).optional(),
    relay: fleetRelaySchema.optional(),
  })
  .catchall(z.unknown());

const fleetPersistedSchema = z
  .object({
    version: z.literal(FLEET_HOSTS_STORAGE_VERSION),
    hosts: z.array(fleetHostSchema),
  })
  .catchall(z.unknown());

const sanitizeHeaders = (headers: Record<string, string> | undefined): Record<string, string> | undefined => {
  if (!headers) return undefined;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.trim();
    if (!name || /[\r\n:]/.test(name) || /[\r\n]/.test(value)) continue;
    if (name.toLowerCase() === 'authorization') continue;
    next[name] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

const toFleetHost = (value: z.infer<typeof fleetHostSchema>): FleetHost | null => {
  const apiUrl = normalizeHostUrl(value.apiUrl);
  if (!apiUrl) return null;
  const requestHeaders = sanitizeHeaders(value.requestHeaders);
  return {
    id: value.id,
    label: value.label,
    apiUrl,
    ...(value.clientToken ? { clientToken: value.clientToken } : {}),
    ...(requestHeaders ? { requestHeaders } : {}),
    ...(value.relay
      ? {
          relay: {
            relayUrl: value.relay.relayUrl,
            serverId: value.relay.serverId,
            hostEncPubJwk: value.relay.hostEncPubJwk,
          },
        }
      : {}),
  };
};

const loadPersistedHosts = (): FleetHost[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(FLEET_HOSTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = fleetPersistedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const seen = new Set<string>();
    const hosts: FleetHost[] = [];
    for (const entry of parsed.data.hosts) {
      const host = toFleetHost(entry);
      if (!host || seen.has(host.id)) continue;
      seen.add(host.id);
      hosts.push(host);
    }
    return hosts;
  } catch {
    return [];
  }
};

const persistHosts = (hosts: FleetHost[]): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      FLEET_HOSTS_STORAGE_KEY,
      JSON.stringify({ version: FLEET_HOSTS_STORAGE_VERSION, hosts }),
    );
  } catch {
    // Quota or privacy mode: live state still works, it just won't survive.
  }
};

const newHostId = (): FleetHostId =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `fleet-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Identity for dedupe: `normalizeHostUrl` keeps a trailing slash, so
 * `https://h:3000/` and `https://h:3000` would otherwise become two tiles. */
const canonicalApiUrl = (apiUrl: string): string => apiUrl.replace(/\/+$/, '');

export type FleetHostInput = {
  label: string;
  apiUrl: string;
  clientToken?: string;
  requestHeaders?: Record<string, string>;
  relay?: FleetHost['relay'];
};

type FleetState = {
  hosts: FleetHost[];
  statuses: Record<FleetHostId, FleetTileStatus>;
  addHost: (input: FleetHostInput) => FleetHostId;
  /** Imports desktop hosts with a direct apiUrl; relay-only hosts are skipped. Returns the number added. */
  importFromDesktopHosts: (hosts: DesktopHost[]) => number;
  removeHost: (id: FleetHostId) => void;
  /** Makes this host the single active runtime for full chat. */
  focusHost: (id: FleetHostId) => void;
  refreshHost: (id: FleetHostId) => Promise<void>;
  refreshAll: () => Promise<void>;
};

export const useFleetStore = create<FleetState>()((set, get) => ({
  hosts: loadPersistedHosts(),
  statuses: {},

  addHost: (input) => {
    const apiUrl = normalizeHostUrl(input.apiUrl);
    if (!apiUrl) throw new Error('invalid-api-url');
    const canonical = canonicalApiUrl(apiUrl);
    const existing = get().hosts.find((host) => canonicalApiUrl(host.apiUrl) === canonical);
    if (existing) return existing.id;
    const id = newHostId();
    const requestHeaders = sanitizeHeaders(input.requestHeaders);
    const host: FleetHost = {
      id,
      label: input.label.trim() || apiUrl,
      apiUrl,
      ...(input.clientToken?.trim() ? { clientToken: input.clientToken.trim() } : {}),
      ...(requestHeaders ? { requestHeaders } : {}),
      ...(input.relay ? { relay: input.relay } : {}),
    };
    set((state) => ({
      hosts: [...state.hosts, host],
      statuses: { ...state.statuses, [id]: { state: 'unknown', checkedAt: Date.now() } },
    }));
    return id;
  },

  importFromDesktopHosts: (desktopHosts) => {
    const knownUrls = new Set(get().hosts.map((host) => canonicalApiUrl(host.apiUrl)));
    const additions: FleetHost[] = [];
    for (const desktopHost of desktopHosts) {
      const apiUrl = desktopHost.apiUrl ? normalizeHostUrl(desktopHost.apiUrl) : null;
      if (!apiUrl || knownUrls.has(canonicalApiUrl(apiUrl))) continue;
      knownUrls.add(canonicalApiUrl(apiUrl));
      const requestHeaders = sanitizeHeaders(desktopHost.requestHeaders);
      additions.push({
        id: desktopHost.id && !get().hosts.some((host) => host.id === desktopHost.id)
          ? desktopHost.id
          : newHostId(),
        label: desktopHost.label,
        apiUrl,
        ...(desktopHost.clientToken ? { clientToken: desktopHost.clientToken } : {}),
        ...(requestHeaders ? { requestHeaders } : {}),
        ...(desktopHost.relay ? { relay: desktopHost.relay } : {}),
      });
    }
    if (additions.length === 0) return 0;
    const now = Date.now();
    set((state) => {
      const statuses = { ...state.statuses };
      for (const host of additions) {
        statuses[host.id] = { state: 'unknown', checkedAt: now };
      }
      return { hosts: [...state.hosts, ...additions], statuses };
    });
    return additions.length;
  },

  removeHost: (id) => {
    // Bumping the generation retires in-flight probes for a host that no
    // longer exists, so a late response can never resurrect it.
    generations.set(id, (generations.get(id) ?? 0) + 1);
    set((state) => {
      const statuses = { ...state.statuses };
      delete statuses[id];
      return {
        hosts: state.hosts.filter((host) => host.id !== id),
        statuses,
      };
    });
  },

  focusHost: (id) => {
    const host = get().hosts.find((entry) => entry.id === id);
    if (!host) return;
    switchRuntimeEndpoint({
      apiBaseUrl: host.apiUrl,
      ...(host.clientToken ? { clientToken: host.clientToken } : {}),
      ...(host.requestHeaders ? { requestHeaders: host.requestHeaders } : {}),
      ...(host.relay ? { relay: host.relay } : {}),
    });
  },

  refreshHost: (id) => {
    const host = get().hosts.find((entry) => entry.id === id);
    if (!host) return Promise.resolve();
    return probeOne(host);
  },

  refreshAll: () => refreshAllInternal(),
}));

// Persist the host list on host membership changes only. Statuses are
// ephemeral probe results: persisting them would rewrite localStorage on every
// poll pass and resurrect stale presence across restarts.
let lastPersistedHosts = useFleetStore.getState().hosts;
useFleetStore.subscribe((state) => {
  if (state.hosts !== lastPersistedHosts) {
    lastPersistedHosts = state.hosts;
    persistHosts(state.hosts);
  }
});

// Per-host generation tokens. A probe commits only when its generation is
// still current AND the host is still a member: removal and newer polls both
// invalidate older in-flight work. Kept outside the store (module state, not
// persisted, never rendered).
const generations = new Map<FleetHostId, number>();

const commitStatus = (id: FleetHostId, generation: number, status: FleetTileStatus): void => {
  const state = useFleetStore.getState();
  if (generations.get(id) !== generation) return;
  if (!state.hosts.some((host) => host.id === id)) return;
  useFleetStore.setState((previous) => ({
    statuses: { ...previous.statuses, [id]: status },
  }));
};

const probeOne = async (host: FleetHost): Promise<void> => {
  const generation = (generations.get(host.id) ?? 0) + 1;
  generations.set(host.id, generation);
  const controller = new AbortController();
  pollControllers.set(host.id, controller);
  const timer = globalThis.setTimeout(() => controller.abort(), FLEET_PROBE_TIMEOUT_MS);
  try {
    const status = await probeFleetHost(host, controller.signal);
    commitStatus(host.id, generation, status);
  } catch {
    // Probe failure is never an empty snapshot: last-known status stands.
  } finally {
    globalThis.clearTimeout(timer);
    if (pollControllers.get(host.id) === controller) {
      pollControllers.delete(host.id);
    }
  }
};

const refreshAllInternal = async (): Promise<void> => {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const hosts = useFleetStore.getState().hosts;
    for (let index = 0; index < hosts.length; index += FLEET_POLL_CONCURRENCY) {
      const chunk = hosts.slice(index, index + FLEET_POLL_CONCURRENCY);
      await Promise.all(chunk.map((host) => probeOne(host)));
    }
  } finally {
    pollInFlight = false;
  }
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
const pollControllers = new Map<FleetHostId, AbortController>();
let pollInFlight = false;

/**
 * Starts lightweight tile polling: one immediate pass, then every
 * `FLEET_POLL_INTERVAL_MS`. Call when the fleet view becomes visible.
 * Idempotent — a running poller is left alone.
 */
export const startFleetPolling = (): void => {
  if (typeof window === 'undefined' || pollTimer !== null) return;
  void refreshAllInternal();
  pollTimer = window.setInterval(() => {
    void refreshAllInternal();
  }, FLEET_POLL_INTERVAL_MS);
};

/**
 * Stops tile polling and aborts in-flight probes. In-flight completions are
 * invalidated by generation bump, so they never write after the view hides.
 * Call when the fleet view hides — hidden means no work.
 */
export const stopFleetPolling = (): void => {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  for (const controller of pollControllers.values()) {
    controller.abort();
  }
  pollControllers.clear();
  for (const id of generations.keys()) {
    generations.set(id, (generations.get(id) ?? 0) + 1);
  }
  pollInFlight = false;
};

export const isFleetPolling = (): boolean => pollTimer !== null;
