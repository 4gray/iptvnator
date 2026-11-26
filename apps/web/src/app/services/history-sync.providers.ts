import { captureHistoryOwner } from '@iptvnator/services/history-events';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { EnvironmentInjector, inject } from '@angular/core';
import type { HistoryPlaylistBridge } from '@iptvnator/services/history-events';
import { historyProfileUsed } from './history-consent';
export function historyPlaylistBridgeFactory(): HistoryPlaylistBridge {
    const injector = inject(EnvironmentInjector);
    return {
        active: historyProfileUsed,
        project: async (playlist) =>
            historyProfileUsed()
                ? (await loadHistoryRuntime(injector)).project(playlist)
                : playlist,
        mutate: async (playlist, action) =>
            historyProfileUsed()
                ? (await loadHistoryRuntime(injector)).mutate(playlist, action)
                : null,
    };
}
export async function loadHistoryRuntime(injector: EnvironmentInjector) {
    const { HistorySyncRuntime } = await import('./history-sync-runtime');
    return injector.get(HistorySyncRuntime);
}
export async function invokeHistory(
    injector: EnvironmentInjector,
    raw: import('@iptvnator/portal/xtream/data-access').IXtreamDataSource,
    method: string,
    args: unknown[]
) {
    const source =
        method === 'clearRecentItems'
            ? args[0]
            : method === 'addRecentItem' || method === 'removeRecentItem'
              ? args[1]
              : undefined;
    const current =
        typeof source === 'string'
            ? captureHistoryOwner(
                  sourceConnection()?.instanceId,
                  source,
                  () => sourceConnection()?.instanceId,
                  'history'
              )
            : () => true;
    const runtime = await loadHistoryRuntime(injector);
    if (!current()) throw new Error('History action ownership changed.');
    return runtime.invoke(raw, method, args);
}
