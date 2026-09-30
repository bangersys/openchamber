import React from 'react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';

import { useFleetStore } from '@/lib/fleet/fleet-store';
import { FleetTile } from './FleetTile';

/**
 * Responsive tile grid. Column count follows the pane width via container
 * queries — never viewport breakpoints, so the grid behaves inside any pane.
 * Arrow keys, Ctrl+N/P, Home/End and Enter all route through the same
 * selection logic; Enter focuses the selected host (full chat takes over
 * the single active runtime).
 */
export function FleetGrid({ onImport }: { onImport: () => void }): React.ReactNode {
  const { t } = useI18n();
  const hosts = useFleetStore((state) => state.hosts);
  const hostIds = React.useMemo(() => hosts.map((host) => host.id), [hosts]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const clampedIndex = hostIds.length === 0 ? 0 : Math.min(selectedIndex, hostIds.length - 1);

  React.useEffect(() => {
    setSelectedIndex((prev) => (hostIds.length === 0 ? 0 : Math.min(prev, hostIds.length - 1)));
  }, [hostIds.length]);

  const focusTileNode = React.useCallback((hostId: string | undefined) => {
    if (!hostId) return;
    const container = containerRef.current;
    if (!container) return;
    let node: Element | null = null;
    try {
      node = container.querySelector(`[data-host-id="${CSS.escape(hostId)}"]`);
    } catch {
      node = container.querySelector('[data-fleet-tile]');
    }
    if (node instanceof HTMLElement) node.focus();
  }, []);

  // Single selection path for arrows, Ctrl+N/P, Home/End and focus restore.
  const selectIndex = React.useCallback(
    (next: number, moveDomFocus: boolean) => {
      if (hostIds.length === 0) return;
      const clamped = Math.max(0, Math.min(hostIds.length - 1, next));
      setSelectedIndex(clamped);
      if (moveDomFocus) focusTileNode(hostIds[clamped]);
    },
    [focusTileNode, hostIds],
  );

  const moveSelection = React.useCallback(
    (delta: number) => selectIndex(clampedIndex + delta, true),
    [clampedIndex, selectIndex],
  );

  const focusSelected = React.useCallback(() => {
    const hostId = hostIds[clampedIndex];
    if (!hostId) return;
    useFleetStore.getState().focusHost(hostId);
    useUIStore.getState().setFleetPageOpen(false);
  }, [clampedIndex, hostIds]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const isNext = event.ctrlKey && (event.key === 'n' || event.key === 'N');
      const isPrev = event.ctrlKey && (event.key === 'p' || event.key === 'P');
      if (isNext) {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (isPrev) {
        event.preventDefault();
        moveSelection(-1);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          moveSelection(-1);
          break;
        case 'Home':
          event.preventDefault();
          selectIndex(0, true);
          break;
        case 'End':
          event.preventDefault();
          selectIndex(hostIds.length - 1, true);
          break;
        case 'Enter':
          event.preventDefault();
          focusSelected();
          break;
        default:
          break;
      }
    },
    [focusSelected, hostIds.length, moveSelection, selectIndex],
  );

  if (hostIds.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="typography-ui-label font-medium text-foreground">{t('mobile.connect.saved.empty')}</p>
        <Button type="button" variant="outline" onClick={onImport}>
          {t('mobile.instances.addManual')}
        </Button>
      </div>
    );
  }

  return (
    <div className="@container/fleet-grid min-h-0 flex-1 overflow-y-auto p-4">
      <div
        ref={containerRef}
        role="listbox"
        aria-label={t('mobile.menu.instances')}
        onKeyDown={handleKeyDown}
        className="grid min-w-0 grid-cols-1 gap-3 @min-[34rem]:grid-cols-2 @min-[54rem]:grid-cols-3"
      >
        {hostIds.map((hostId, index) => (
          <FleetTile
            key={hostId}
            hostId={hostId}
            selected={index === clampedIndex}
            tabIndex={index === clampedIndex ? 0 : -1}
            onTileFocus={() => selectIndex(index, false)}
          />
        ))}
      </div>
    </div>
  );
}
