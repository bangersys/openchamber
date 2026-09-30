import React from 'react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { isDesktopShell } from '@/lib/desktop';
import { desktopHostsGet } from '@/lib/desktopHosts';

import {
  startFleetPolling,
  stopFleetPolling,
  useFleetStore,
} from '@/lib/fleet/fleet-store';
import { FleetGrid } from './FleetGrid';

/**
 * Fleet page wrapper: translated header, add-by-address form, tile grid.
 * Header counts use complete-message keys (never grammar fragments).
 * Polling runs only while this view is mounted; unmount stops all work.
 */
export function FleetView(): React.ReactNode {
  const { t } = useI18n();
  const statuses = useFleetStore((state) => state.statuses);
  const addHost = useFleetStore((state) => state.addHost);
  const [formOpen, setFormOpen] = React.useState(false);
  const [apiUrl, setApiUrl] = React.useState('');
  const [clientToken, setClientToken] = React.useState('');
  const [formError, setFormError] = React.useState(false);
  // Desktop import reads the Electron-side host config; on every other
  // runtime the call answers empty, so the button is not offered there.
  const showImport = React.useMemo(() => isDesktopShell(), []);

  React.useEffect(() => {
    startFleetPolling();
    return () => {
      stopFleetPolling();
    };
  }, []);

  const totalSessions = React.useMemo(
    () =>
      Object.values(statuses).reduce((sum, entry) => sum + (entry.sessionTotal ?? 0), 0),
    [statuses],
  );

  const handleAdd = (): void => {
    try {
      addHost({ label: apiUrl.trim(), apiUrl: apiUrl.trim(), clientToken: clientToken.trim() || undefined });
    } catch {
      setFormError(true);
      return;
    }
    setApiUrl('');
    setClientToken('');
    setFormError(false);
    setFormOpen(false);
    void useFleetStore.getState().refreshAll();
  };

  const handleImport = React.useCallback(async (): Promise<void> => {
    try {
      const config = await desktopHostsGet();
      useFleetStore.getState().importFromDesktopHosts(config.hosts);
      await useFleetStore.getState().refreshAll();
    } catch {
      // Import is best-effort: the empty state remains with the manual form.
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/50 px-6 py-3">
        <h1 className="truncate typography-ui-label font-semibold">{t('mobile.menu.instances')}</h1>
        <span className="shrink-0 typography-micro text-muted-foreground">
          {totalSessions === 1
            ? t('mobile.sessions.project.sessionsSingle')
            : t('mobile.sessions.project.sessionsPlural', { count: totalSessions })}
        </span>
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {showImport ? (
            <Button type="button" size="sm" variant="outline" onClick={handleImport}>
              {t('fleet.importAction')}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setFormOpen((open) => !open)}>
            {t('mobile.instances.addTitle')}
          </Button>
        </span>
      </header>
      {formOpen ? (
        <div className="flex shrink-0 flex-col gap-2 border-b border-border/50 px-6 py-3">
          <label className="flex min-w-0 flex-col gap-1 typography-micro text-muted-foreground">
            {t('mobile.connect.url.label')}
            <input
              value={apiUrl}
              onChange={(event) => {
                setApiUrl(event.target.value);
                setFormError(false);
              }}
              placeholder="https://blaze-1.example.com:3000"
              inputMode="url"
              autoComplete="off"
              className="h-9 w-full max-w-md rounded-md border border-border bg-surface px-3 text-foreground typography-ui-label placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 typography-micro text-muted-foreground">
            {t('mobile.connect.token.label')}
            <input
              value={clientToken}
              onChange={(event) => setClientToken(event.target.value)}
              type="password"
              autoComplete="off"
              className="h-9 w-full max-w-md rounded-md border border-border bg-surface px-3 text-foreground typography-ui-label placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {formError ? (
            <p className="typography-micro text-status-error">{t('mobile.connect.error.unreachable')}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="default" onClick={handleAdd}>
              {t('mobile.instances.saveNew')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setFormOpen(false)}>
              {t('mobile.instances.cancelEdit')}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <FleetGrid onAdd={() => setFormOpen(true)} />
      </div>
    </div>
  );
}
