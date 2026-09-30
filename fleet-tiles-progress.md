# Fleet tiles — request log and work done (branch `railway/fleet-tiles`)

## What you asked for (in order)

1. Analyze the project fully — all READMEs — and build it, then do dev work.
2. Check whether OpenChamber has code for **remote OpenCode servers** (pairing etc.), and whether remote
   `opencode serve` instances on other machines can be added. List all the mechanisms; read AGENTS.md and
   related docs.
3. Your setup: many workspaces/VMs, each running `opencode serve` with a password, reachable through
   Cloudflare tunnels or self-hosted rathole (e.g. `blaze.*` URLs). You want **one UI over all of them**
   via their REST APIs — at OpenChamber level, not by attaching to a local OpenCode. Asked for research
   on how this can be done.
4. Clarified: all 10 VMs must be usable **in parallel** — is OpenChamber one-at-a-time?
5. Confirmed you do **not** want the local-OpenCode attach model (`OPENCODE_HOST` proxy). Asked me to
   confirm understanding first.
6. Confirmed: VMs run **opencode only**; you want all tiles **live side-by-side in one main window** —
   tiled view, click into any one, full OpenChamber UI per tile; local vs remote must not matter.
7. Asked where the **server-side proxy to dodge CORS** comes from; you don't open anything in a browser.
8. Asked whether OpenChamber uses a browser (Electron?) — explained every surface is a web engine.
9. Asked whether current OpenChamber remote uses **bare opencode or OpenChamber+OpenCode both**.
10. Asked: if we install **OpenChamber+OpenCode on each VM**, is it UI-only work with no API writing?
11. Ordered: plan with the listed skills, reuse existing libs/components, delegate to parallel agents, work
    on a **new branch**, build the full system now, follow AGENTS.md + skills, read code first.
12. Told me not to commit yet — wait for your comments. Asked why validation takes long.
13. Ordered to finish the pending type-check command.
14. This file: start-to-end log + all files touched.

## Decisions you locked

- VMs run `opencode serve` today; agreed path is **OpenChamber+OpenCode on each VM** (managed lifecycle),
  so no new backend APIs are needed.
- Tiled overview in one window; click a tile → that host becomes the single active runtime with the full
  UI (no multi-runtime full chat in v1 — singleton `activeApiBaseUrl` stays authoritative).
- Tiles are lightweight best-effort status cards; failure never clears state.

## Work done (start to end)

1. Read root README, AGENTS.md, package.json, CONTRIBUTING; loaded skills
   (ui-api-decoupling, enterprise-boundary, relay-transport, opencode-v2, sync-state-invariants,
   openchamber-change-discipline, performance-engineering, theme-system, locale-ui-patterns,
   settings-ui-patterns); read sync/stores DOCUMENTATION.
2. Mapped mechanisms: managed/external OpenCode lifecycle (`server/lib/opencode/`), pairing v2,
   private relay, desktop hosts + runtime-switch, SSH remote instances (installs `@openchamber/web`
   remotely — both, not bare), tunnels, LAN/direct. Researched upstream `opencode serve`
   (`--hostname/--port/--cors`, `OPENCODE_SERVER_PASSWORD` → Basic `opencode:<pw>`, OpenAPI `/doc`).
3. Created branch `railway/fleet-tiles`; fanned out 3 parallel agents (fleet store, tile components,
   wiring map). Unified their divergent outputs onto `lib/fleet` as single owner.
4. Implemented Fleet v1, wired it as a full-page surface, added probe tests, validated.

## Files touched

New — `packages/ui/src/lib/fleet/`:
- `fleet-types.ts` — `FleetHost` (DesktopHost projection, required direct `apiUrl`), `FleetTileStatus`.
- `fleet-probe.ts` — pure per-host probe (`/health` → `/api/version` → `/auth/session` →
  best-effort `/api/sessions/status` counts); never throws; zod at the boundary.
- `fleet-store.ts` — zustand hosts + statuses, localStorage persistence (v1 envelope, malformed →
  empty), desktop-host import (relay-only skipped), per-host generation tokens, 8s timeout, 4-wide
  concurrency, 30s visible-only polling, `focusHost` via `switchRuntimeEndpoint`.
- `fleet-probe.test.ts` — 7 tests (offline/auth/incompatible/online/malformed).
- `DOCUMENTATION.md` — ownership, invariants, polling budget.

New — `packages/ui/src/components/views/fleet/`:
- `FleetTile.tsx` — leaf subscriptions, `status.*` dot, Focus (focus + close page) / Remove.
- `FleetGrid.tsx` — container-query grid, arrows + Ctrl+N/P + Home/End + Enter, empty state.
- `FleetView.tsx` — header counts, add-by-address form (URL + token), import, polling lifecycle.
- `index.ts` — view re-exports only.

Modified:
- `packages/ui/src/stores/useUIStore.ts` — `isFleetPageOpen` + `setFleetPageOpen`, mutually exclusive
  with all other full-page surfaces + `closeMainSurfaces`.
- `packages/ui/src/components/layout/MainLayout.tsx` — Fleet overlay next to UsageStatsView.

## Validation

- Pass: probe tests 7/7, `runtime-switch` + `runtime-key` + `useUIStore.sidebar` 13/13, eslint clean on
  all touched files, scoped `tsc` zero errors in touched files.
- Not done (state why): full-workspace `tsc` OOMs (2.2GB VM, container heap cap ~1.1GB — env limit, run
  on CI/bigger box), `knip` dead-code, production build, live run in app.

## Known gaps for your review

- No sidebar/menu/command-palette entry opens the Fleet page yet (`setFleetPageOpen(true)` only).
- Tiles are status cards; Focus switches the single active runtime (no parallel full chats).
- No non-English i18n work needed (zero new keys — all reused).
