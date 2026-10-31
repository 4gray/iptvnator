import {
    createRandomId,
    type PlayerContentInfo,
    type PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
import {
    EnvironmentInjector,
    inject,
    provideAppInitializer,
} from '@angular/core';
import {
    ElectronXtreamDataSource,
    PwaXtreamDataSource,
    XTREAM_DATA_SOURCE,
    type IXtreamDataSource,
} from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { PLAYBACK_ACTIVITY_EVENTS } from '@iptvnator/services/activity-events';
import { activityEnabled } from './activity-consent';

export function provideActivitySync() {
    return [
        {
            provide: XTREAM_DATA_SOURCE,
            useFactory: () => {
                const runtime = inject(RuntimeCapabilitiesService);
                const raw = runtime.supportsXtreamSqliteDataSource
                    ? inject(ElectronXtreamDataSource)
                    : inject(PwaXtreamDataSource);
                const injector = inject(EnvironmentInjector);
                return new Proxy(raw, {
                    get(target, key) {
                        const value = Reflect.get(target, key);
                        if (typeof value !== 'function') return value;
                        const local = value.bind(target);
                        if (!String(key).includes('PlaybackPosition'))
                            return local;
                        return async (...args: unknown[]) => {
                            if (!activityEnabled()) return local(...args);
                            const service = await loadActivityRuntime(injector);
                            return service.invoke(raw, String(key), args);
                        };
                    },
                }) as IXtreamDataSource;
            },
        },
        {
            provide: PLAYBACK_ACTIVITY_EVENTS,
            useFactory: () => {
                const injector = inject(EnvironmentInjector);
                return {
                    active: activityEnabled,
                    checkpoint: async (position: PlaybackPositionData) => {
                        if (!activityEnabled()) return;
                        await (
                            await loadActivityRuntime(injector)
                        ).checkpoint(position);
                    },
                    begin: async (
                        info: PlayerContentInfo,
                        startTime = 0,
                        title?: string
                    ) => {
                        if (!activityEnabled()) return;
                        info.activitySessionId ??= createRandomId();
                        if (title) info.activityTitle = title.slice(0, 512);
                        const service = await loadActivityRuntime(injector);
                        await service.begin({
                            ...info,
                            positionSeconds: startTime,
                        });
                    },
                    register: async (
                        sourceId: string,
                        positions: PlaybackPositionData[]
                    ) => {
                        if (!activityEnabled()) return;
                        (await loadActivityRuntime(injector)).register(
                            sourceId,
                            positions
                        );
                    },
                };
            },
        },
        provideAppInitializer(() => {
            if (!activityEnabled()) return;
            const injector = inject(EnvironmentInjector);
            void loadActivityRuntime(injector).catch(() => undefined);
        }),
    ];
}

export async function loadActivityRuntime(injector: EnvironmentInjector) {
    const { ActivitySyncRuntime } = await import('./activity-sync-runtime');
    return injector.get(ActivitySyncRuntime);
}
