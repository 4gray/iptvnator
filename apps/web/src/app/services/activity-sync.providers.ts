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
import type { ActivitySyncRuntime } from './activity-sync-runtime';

const runtimes = new WeakMap<EnvironmentInjector, ActivitySyncRuntime>();

export function activityDataSourceFactory(): IXtreamDataSource {
    const injector = inject(EnvironmentInjector);
    return new Proxy(xtreamDataSourceFactory(), {
        get(target, key) {
            const value = Reflect.get(target, key);
            if (typeof value !== 'function') return value;
            const local = value.bind(target);
            const method = String(key);
            if (!method.includes('PlaybackPosition')) return local;
            return async (...args: unknown[]) => {
                const existing = runtimes.get(injector);
                if (!existing && !activityEnabled()) return local(...args);
                const service =
                    existing ?? (await loadActivityRuntime(injector));
                return service.invoke(target, method, args);
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
            startTime?: number,
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
    const service = injector.get(ActivitySyncRuntime);
    runtimes.set(injector, service);
    return service;
}
