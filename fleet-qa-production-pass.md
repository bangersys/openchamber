# Fleet tiles — production-readiness pass (branch `feat/fleet-tiles-view`)

Follow-up to `fleet-tiles-progress.md`. This file records the QA findings, the
fixes applied, validation evidence, and the work deliberately left for the
maintainer.

## QA findings (all fixed unless noted)

1. **Dead feature — no entrypoint.** Nothing called `setFleetPageOpen(true)`,
   so the Fleet page was unreachable. Fixed: `open-fleet` item in the command
   palette (`packages/ui/src/components/ui/CommandPalette.tsx`), reusing the
   exact-meaning `mobile.menu.instances` copy and the existing `server` sprite
   icon — zero new keys. Mounts in `MainLayout` next to the other full-page
   surfaces.
2. **localStorage write on every probe.** The store subscription persisted on
   *every* state change, including status commits each poll pass. Fixed:
   subscribe compares the hosts reference, so only membership changes write.
   Statuses stay in memory; restarts re-probe instead of showing stale
   presence. Proven by test (`probe commits do not rewrite persisted storage`).
3. **Trailing-slash dedupe bug** (caught by the new tests). `normalizeHostUrl`
   keeps a trailing slash, so `https://h:3000/` and `https://h:3000` became two
   tiles. Fixed with `canonicalApiUrl` in `addHost` and
   `importFromDesktopHosts`.
4. **Dead store state.** `defaultHostId` / `setDefault` / `setFocus` /
   `focusHostId` were written but never read (would trip `knip`). Removed;
   reference grep confirms zero remaining usages.
5. **Mislabeled Import.** The desktop-import button was labeled "Add by
   address" and the empty state triggered a desktop import that silently
   no-ops off Electron (`desktopHostsGet` answers empty without the Electron
   IPC bridge). Fixed: import button is Electron-gated (`isDesktopShell`)
   with a new `fleet.importAction` key translated in all 13 locales; the empty
   state now opens the add-by-address form (`FleetGrid` prop `onImport` →
   `onAdd`).
6. **Type hack + ARIA.** `STATUS_MESSAGE_KEY` mapped `online` to `''` cast as
   `I18nKey`; now `I18nKey | null`. `role="listbox"`/`role="option"` wrapping
   buttons is invalid ARIA (interactive descendants of an option); now plain
   `role="list"` + `aria-current` on the selected tile. Keyboard nav
   (arrows, Ctrl+N/P, Home/End, Enter) unchanged.
7. **Double overlay positioning.** `FleetView` rendered its own
   `absolute inset-0` inside `MainLayout`'s absolute wrapper (contrast
   `UsageStatsView`, which is layout-neutral). Now `flex h-full`.

## Validation evidence

- `bun test` fleet probe + store + i18n parity: **16 pass, 0 fail**
  (503 assertions).
- Scoped `tsc` over the fleet module graph: **zero errors in every touched
  file** (remaining errors are `process`-global usages in two untouched files,
  an artifact of the scoped harness, not the diff).
- `eslint` on all touched UI files: clean.
- Reference greps for every removed/renamed export: no dangling usages.

## Not validated (environment limits, stated honestly)

- Full-workspace `tsc`: killed repeatedly by VM restarts; also OOM-prone on
  this 2.2 GB box (same limit noted in the prior session).
- `knip` full-repo scan: same restart problem; substituted with the reference
  greps above.
- `oxlint`: the vendored binary panics on this machine even for untouched
  files — broken environment-wide, unrelated to this change.
- No live multi-host run: needs N OpenChamber servers with network/CORS
  configured (see below).

## Work left for the maintainer (product decisions, not built)

1. **Remote-web cross-origin probing.** The server only answers CORS for
   packaged (`openchamber-ui://app`, Capacitor) and loopback origins
   (`packages/web/server/index.js`). A web UI served from one host cannot
   probe another host from the browser — those tiles read
   `offline`/`network-error`. Fully live on Electron, Capacitor, and localhost
   dev. Cross-host probing from a remote web origin needs a server-side proxy
   route (SSRF-sensitive) — your call.
2. **Tunnel-scope auth copy.** On hosts with an active OpenChamber tunnel,
   `/auth/session` 401s with `tunnelLocked` regardless of bearer; the tile
   says "needs a password or client token", which can't fix that case.
   Cosmetic; flagged, not fixed.
3. **Tiles remain status cards.** Focus switches the single active runtime via
   the established `switchRuntimeEndpoint` flow; parallel full chats are out
   of scope for v1 by prior decision.
