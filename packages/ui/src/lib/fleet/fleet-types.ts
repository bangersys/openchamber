import type { DesktopHost } from '../desktopHosts';

/**
 * Stable fleet host identity. Hosts, statuses, and poll generations are all
 * keyed by this id — never by URL, label, or array position.
 */
export type FleetHostId = string;

/**
 * A fleet tile target. Reuses the `DesktopHost` shape (no field is
 * re-declared here) with `apiUrl` narrowed to required: fleet tiles probe
 * over plain direct HTTP, so relay-only hosts without an `apiUrl` cannot be
 * fleet members and are skipped on import.
 */
export type FleetHost = Pick<
  DesktopHost,
  'id' | 'label' | 'clientToken' | 'requestHeaders' | 'relay'
> & {
  apiUrl: string;
};

/**
 * Best-effort tile status for one fleet host. `unknown` is the initial state
 * before the first probe lands and the fallback when a probe cannot determine
 * anything; it must never be rendered as a definitive offline verdict.
 */
export type FleetTileStatus = {
  state: 'unknown' | 'online' | 'offline' | 'auth' | 'incompatible';
  serverVersion?: string;
  /** Sessions tracked by the host's status map (approximation, not a census). */
  sessionTotal?: number;
  /** Sessions in the host's status map reporting busy/retry. */
  activeCount?: number;
  latencyMs?: number;
  checkedAt?: number;
  /** Machine-readable probe code (e.g. `timeout`, `network-error`, `http-500`). */
  detail?: string;
};
