import {
    createRandomId,
    type PlayerContentInfo,
    type PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
import { EnvironmentInjector, inject } from '@angular/core';
import {
    xtreamDataSourceFactory,
    type IXtreamDataSource,
} from '@iptvnator/portal/xtream/data-access';
import { activityEnabled } from './activity-consent';

export function activityDataSourceFactory(): IXtreamDataSource {
    const raw = xtreamDataSourceFactory();
    const injector = inject(EnvironmentInjector);
    return new Proxy(raw, {
        get(target, key) {
            const value = Reflect.get(target, key);
            if (typeof value !== 'function') return value;
            const local = value.bind(target);
            if (!String(key).includes('PlaybackPosition')) return local;
            return async (...args: unknown[]) => {
                if (!activityEnabled()) return local(...args);
                const service = await loadActivityRuntime(injector);
                return service.invoke(raw, String(key), args);
            };
        },
    }) as IXtreamDataSource;
}

export function activityEventsFactory() {
    const injector = inject(EnvironmentInjector);
    return {
        active: activityEnabled,
        checkpoint: async (position: PlaybackPositionData) => {
            if (!activityEnabled()) return;
            await (await loadActivityRuntime(injector)).checkpoint(position);
        },
        begin: async (
            info: PlayerContentInfo,
            startTime = 0,
            title?: string
        ) => {
            if (!activityEnabled()) return;
            info.activitySessionId ??= createRandomId();
            if (title) info.activityTitle = title.slice(0, 512);
            await (await loadActivityRuntime(injector)).begin(info, startTime);
        },
        register: async (
            sourceId: string,
            positions: PlaybackPositionData[]
        ) => {
            if (!activityEnabled()) return;
            (await loadActivityRuntime(injector)).register(sourceId, positions);
        },
    };
}

export async function loadActivityRuntime(injector: EnvironmentInjector) {
    const { ActivitySyncRuntime } = await import('./activity-sync-runtime');
    return injector.get(ActivitySyncRuntime);
}
