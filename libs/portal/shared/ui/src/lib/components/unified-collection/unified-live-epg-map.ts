import { effect, inject, Signal, signal, untracked } from '@angular/core';
import { StreamResolverService } from '@iptvnator/portal/shared/data-access';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { EpgProgram } from '@iptvnator/shared/interfaces';

export interface UnifiedLiveEpgMap {
    /** What is on now, per collection row, for the channel rail. */
    readonly programs: Signal<Map<string, EpgProgram | null>>;
    load(items: UnifiedCollectionItem[]): void;
    clear(): void;
}

/**
 * The "now playing" programme of every row in the live rail. Must run in an
 * injection context (the hosting component's field initializer).
 */
export function createUnifiedLiveEpgMap(options: {
    supportsEpg: boolean;
    items: Signal<UnifiedCollectionItem[]>;
    /** EPG display offset; the map answers "what is on at that clock". */
    offsetMinutes: Signal<number>;
}): UnifiedLiveEpgMap {
    const streamResolver = inject(StreamResolverService);
    const programs = signal<Map<string, EpgProgram | null>>(new Map());
    let requestId = 0;

    const load = (items: UnifiedCollectionItem[]): void => {
        // Only the latest load may install its map: an older one — started
        // under a previous display offset or item set — must not overwrite
        // the refreshed result when it completes last.
        const currentRequestId = ++requestId;
        void streamResolver.loadEpgForItems(items).then((epgMap) => {
            if (currentRequestId === requestId) {
                programs.set(epgMap);
            }
        });
    };

    // A changed display offset reloads the map; the request id above drops
    // the older load. The first run only records the initial value.
    let appliedOffsetMinutes: number | null = null;
    effect(() => {
        const offsetMinutes = options.offsetMinutes();
        if (appliedOffsetMinutes === offsetMinutes) {
            return;
        }
        const isInitial = appliedOffsetMinutes === null;
        appliedOffsetMinutes = offsetMinutes;
        if (isInitial || !options.supportsEpg) {
            return;
        }
        load(untracked(() => options.items()));
    });

    return {
        programs: programs.asReadonly(),
        load,
        clear(): void {
            requestId += 1;
            programs.set(new Map());
        },
    };
}
