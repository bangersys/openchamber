import React from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/useUIStore';

import { useFleetStore } from '@/lib/fleet/fleet-store';
import type { FleetTileStatus } from '@/lib/fleet/fleet-types';

type TileState = FleetTileStatus['state'];

const STATUS_MESSAGE_KEY: Record<TileState, I18nKey> = {
  unknown: 'common.loading',
  online: '',
  offline: 'mobile.connect.error.unreachable',
  auth: 'mobile.connect.error.authRequired',
  incompatible: 'opencodeCompatibility.title',
};

const STATUS_DOT_CLASS: Record<TileState, string> = {
  unknown: 'bg-[var(--status-info)]',
  online: 'bg-[var(--status-success)]',
  offline: 'bg-[var(--status-error)]',
  auth: 'bg-[var(--status-warning)]',
  incompatible: 'bg-[var(--status-warning)]',
};

const hostPart = (apiUrl: string): string => {
  const trimmed = apiUrl.trim();
  if (!trimmed) return trimmed;
  try {
    return new URL(trimmed).host || trimmed;
  } catch {
    return trimmed;
  }
};

export interface FleetTileProps {
  hostId: string;
  selected?: boolean;
  tabIndex?: number;
  onTileFocus?: (hostId: string) => void;
}

export function FleetTile({ hostId, selected, tabIndex, onTileFocus }: FleetTileProps): React.ReactNode {
  const { t } = useI18n();
  // Leaf slices only: this tile ignores every other host in the fleet.
  const host = useFleetStore((state) => state.hosts.find((entry) => entry.id === hostId));
  const status = useFleetStore((state) => state.statuses[hostId] ?? { state: 'unknown' as const });
  const removeHost = useFleetStore((state) => state.removeHost);
  const focusHost = useFleetStore((state) => state.focusHost);

  const statusKey = STATUS_MESSAGE_KEY[status.state];

  const handleFocus = (): void => {
    focusHost(hostId);
    useUIStore.getState().setFleetPageOpen(false);
  };

  return (
    <article
      data-fleet-tile
      data-host-id={hostId}
      role="option"
      aria-selected={selected ?? undefined}
      tabIndex={tabIndex ?? 0}
      onFocus={() => onTileFocus?.(hostId)}
      className={cn(
        'oc-surface-elevated flex min-w-0 flex-col gap-2 rounded-md border border-border/60 bg-surface-elevated p-3',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-ring',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          aria-hidden="true"
          className={cn('mt-1.5 size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[status.state])}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate typography-ui-label font-medium text-foreground" title={host?.label ?? hostId}>
            {host?.label ?? hostId}
          </p>
          {host ? (
            <p
              className="truncate typography-micro text-muted-foreground"
              title={host.apiUrl}
            >
              {hostPart(host.apiUrl)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => removeHost(hostId)}
          aria-label={t('mobile.sessions.removeProjectAria', { label: host?.label ?? hostId })}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="delete-bin" className="size-4" />
        </button>
      </div>

      {statusKey ? (
        <p className="typography-micro text-muted-foreground">{t(statusKey)}</p>
      ) : (
        <p className="typography-micro text-muted-foreground">
          {(status.sessionTotal ?? 0) === 1
            ? t('mobile.sessions.project.sessionsSingle')
            : t('mobile.sessions.project.sessionsPlural', { count: status.sessionTotal ?? 0 })}
          {(status.activeCount ?? 0) > 0
            ? ` · ${t('chat.statusRow.summary.activeLeft', {
                active: status.activeCount ?? 0,
                left: Math.max(0, (status.sessionTotal ?? 0) - (status.activeCount ?? 0)),
              })}`
            : null}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="default"
          onClick={handleFocus}
        >
          {t('mobile.connect.connectButton')}
        </Button>
      </div>
    </article>
  );
}
