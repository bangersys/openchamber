# Fleet (multi-server tiles)

## Ownership

`packages/ui/src/lib/fleet/` owns the fleet overview: a tiled look at N
OpenChamber servers (each VM runs `@openchamber/web` plus its managed
opencode). Files:

- `fleet-types.ts` — `FleetHost` (a `DesktopHost` projection with a required
  direct `apiUrl`; no field is re-declared) and `FleetTileStatus`.
- `fleet-probe.ts` — pure per-host status probe over plain `fetch`.
- `fleet-store.ts` — zustand host list plus statuses, poll lifecycle, and
  click-to-focus.

## Invariants

- **One active runtime for the full UI.** Tiles are best-effort status cards
  only. Full chat, sync, and every directory store stay on the single active
  runtime (`lib/runtime-switch.ts`). Clicking a tile calls
  `switchRuntimeEndpoint` with that host's endpoint — focus, not a second
  live session.
- **Tiles never disturb the active runtime.** The probe uses plain `fetch`
  against each host's own `apiUrl`, never `runtimeFetch` and never the active
  bearer. Relay-only desktop hosts (no direct `apiUrl`) cannot be probed this
  way and are skipped on import.
- **Failure is not empty, and error is not reachability.** A probe that
  throws preserves last-known status; only a landed probe result replaces it.
  A 401/403 from `/auth/session` means the token is wrong (`auth`), not that
  the host is down. A missing/unrecognized `/api/version` identity means the
  address is not an OpenChamber server (`incompatible`), not `offline`.
- **Stale work never publishes.** Every probe carries the host's generation
  token. Removal bumps the generation, and a newer poll pass bumps it again,
  so a late response for a removed host or an older poll can never overwrite
  newer state or resurrect a deleted tile.
- **Network payloads are parsed at the boundary.** Probe bodies and the
  persisted host envelope go through narrow zod schemas; malformed input is
  dropped (malformed envelope means an empty host list, never a crash).
  Everything is keyed by stable host id, never URL or position.
- **No user-facing strings live in the store or probe.** `detail` carries
  machine codes only (`aborted`, `network-error`, `http-401`,
  `version-mismatch`, `unexpected-service`, `invalid-api-url`). Copy belongs
  to the view layer.

## Polling budget

- At most 4 concurrent host probes per pass; each probe is aborted at 8s.
- One pass on view open, then every 30s — only while the fleet view is
  visible (`startFleetPolling` / `stopFleetPolling`). Hidden means no timers,
  no requests: stop aborts in-flight probes and invalidates their generations.
- Overlapping passes are skipped (stale-while-revalidate); the next tick
  retries.
- Session counts come from the host's `/api/sessions/status` map: `activeCount`
  is busy/retry entries, `sessionTotal` is tracked keys — an approximation of
  coverage, not a session census. Count failure never fails the tile.
- Version compatibility compares the major of the host's
  `openchamberVersion` against the local `__APP_VERSION__` major only; when
  either side is unknown, no mismatch is reported.
