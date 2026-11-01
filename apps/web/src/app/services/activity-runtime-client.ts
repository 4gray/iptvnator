import {
    ActivitySyncClient,
    ElectronActivityLocalStore,
    IndexedDbActivityLocalStore,
    type ActivityClientOptions,
} from '@iptvnator/services/activity-sync';
import type {
    RuntimeCapabilitiesService,
    PlaybackPositionRuntimeBridgeService,
} from '@iptvnator/services';
import type { ActivitySourceContext } from '@iptvnator/shared/interfaces/activity-sync';
import { requestSourceServer } from '@iptvnator/services/source-sync';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { readActivityConsent } from './activity-consent-state';
import { ActivityPositionAdapter } from './activity-position-adapter';
import { ActivityLocalOnlyPositions } from './activity-local-only-positions';

/** Bind delivery and persistence to a verified server profile before any activity request. */
export function createActivityRuntimeClient(
    capabilities: RuntimeCapabilitiesService,
    positionsBridge: PlaybackPositionRuntimeBridgeService,
    events: Pick<ActivityClientOptions, 'changed' | 'status'>,
    paused: () => boolean = () => false
) {
    const instanceId = sourceConnection()?.instanceId;
    const consent = readActivityConsent();
    if (!instanceId || !consent || !capabilities.supportsActivityStorage)
        throw new Error('Activity profile unavailable');
    const contextKey = `iptvnator-server:${instanceId}:activity-contexts-v1`;
    let contexts: ActivitySourceContext[] = [];
    try {
        const saved: unknown = JSON.parse(
            localStorage.getItem(contextKey) ?? '[]'
        );
        if (Array.isArray(saved))
            contexts = saved.filter(
                (context) =>
                    context &&
                    typeof context.sourceId === 'string' &&
                    typeof context.sourceIncarnation === 'string' &&
                    ['xtream', 'stalker'].includes(context.provider)
            );
    } catch {
        /* Recover contexts from the server. */
    }
    const store = capabilities.isElectron
        ? new ElectronActivityLocalStore(instanceId, (request) =>
              window.electron!.activityLocalRequest!(request)
          )
        : new IndexedDbActivityLocalStore(instanceId);
    const localOnly = new ActivityLocalOnlyPositions(instanceId, localStorage);
    const client = new ActivitySyncClient(store, {
        committed: (sourceId, position, kind) =>
            localOnly.committed(sourceId, position, kind),
        instanceId,
        deviceId: consent.deviceId,
        contexts,
        consent: () => {
            const value = readActivityConsent();
            return value?.enabled && !value.disabling && !paused()
                ? value.generation
                : null;
        },
        request: requestSourceServer,
        remember: (value) =>
            localStorage.setItem(contextKey, JSON.stringify(value)),
        ...events,
    });
    const adapter = new ActivityPositionAdapter(
        client,
        capabilities.supportsXtreamSqliteDataSource
            ? {
                  save: (sourceId, data) =>
                      positionsBridge.savePlaybackPositionOrThrow(
                          sourceId,
                          data
                      ),
                  clear: (sourceId, id, type) =>
                      positionsBridge.clearPlaybackPositionOrThrow(
                          sourceId,
                          id,
                          type
                      ),
              }
            : undefined,
        localOnly
    );

    return { client, adapter };
}
