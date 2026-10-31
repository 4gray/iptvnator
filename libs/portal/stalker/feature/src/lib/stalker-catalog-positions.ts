import {
    computed,
    DestroyRef,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import {
    StalkerStore,
    StalkerVodSource,
    isStalkerSeriesFlag,
} from '@iptvnator/portal/stalker/data-access';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    PORTAL_PLAYBACK_POSITIONS,
    PortalCatalogItemProgress,
    getPortalPlaybackProgressPercent,
    resolvePortalSeriesWatchState,
    resolvePortalWatchState,
} from '@iptvnator/portal/shared/util';

/** Route-owned progress snapshot; live writes win over older snapshot reads. */
export function createStalkerCatalogPositions(
    store: InstanceType<typeof StalkerStore>
) {
    const persistence = inject(PORTAL_PLAYBACK_POSITIONS);
    const bridge = inject(PlaybackPositionRuntimeBridgeService);
    const destroyRef = inject(DestroyRef);
    const owner = signal<string | null>(null);
    const rows = signal(new Map<string, PlaybackPositionData>());
    const state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const snapshot = signal(false);
    let generation = 0;
    let disposed = false;
    // Each read gets its own overlay, so updates during overlapping reads
    // survive whichever snapshot eventually wins.
    const pendingReads = new Set<Map<string, PlaybackPositionData>>();
    const key = (row: PlaybackPositionData) =>
        `${row.contentType}_${row.contentXtreamId}`;
    const current = () => store.currentPlaylist()?._id ?? null;
    const ownsSnapshot = computed(() => owner() === current() && snapshot());
    const loadState = computed(() =>
        owner() === current() ? state() : 'idle'
    );

    function activate(id: string | null): void {
        if (owner() === id) return;
        generation++;
        owner.set(id);
        rows.set(new Map());
        snapshot.set(false);
        state.set('idle');
        pendingReads.clear();
    }

    async function refresh(id: string): Promise<void> {
        if (disposed || id !== current()) return;
        activate(id);
        const request = ++generation;
        const overlay = new Map<string, PlaybackPositionData>();
        pendingReads.add(overlay);
        state.set('loading');
        try {
            const positions = await persistence.getAllPlaybackPositions(id);
            if (disposed || request !== generation || id !== current()) return;
            const next = new Map(positions.map((row) => [key(row), row]));
            overlay.forEach((row, id) => next.set(id, row));
            rows.set(next);
            snapshot.set(true);
            state.set('ready');
        } catch (error) {
            if (!disposed && request === generation && id === current())
                state.set('error');
            throw error;
        } finally {
            pendingReads.delete(overlay);
        }
    }

    effect(() => {
        const id = current();
        untracked(() => {
            if (owner() !== id || state() === 'idle') {
                activate(id);
                if (id) void refresh(id).catch(() => undefined);
            }
        });
    });
    const unsubscribe = bridge.onPlaybackPositionUpdate((data) => {
        if (!data.playlistId || data.playlistId !== current()) return;
        activate(data.playlistId);
        pendingReads.forEach((overlay) => overlay.set(key(data), data));
        rows.update((previous) => new Map(previous).set(key(data), data));
        void persistence
            .savePlaybackPosition(data.playlistId, data)
            .catch(() => undefined);
    });
    destroyRef.onDestroy(() => {
        disposed = true;
        generation++;
        unsubscribe?.();
    });

    const seriesPositions = computed(() => {
        const result = new Set<number>();
        if (owner() === current())
            rows().forEach((row) => {
                if (row.contentType === 'episode' && row.seriesXtreamId)
                    result.add(row.seriesXtreamId);
            });
        return result;
    });
    function getItemProgress(
        item: StalkerVodSource
    ): PortalCatalogItemProgress {
        const rawId = item.id;
        if (
            rawId === undefined ||
            rawId === null ||
            String(rawId).trim() === ''
        )
            return {};
        const id = Number(rawId);
        if (!Number.isFinite(id)) return {};
        const hasSeriesProgress = seriesPositions().has(id);
        if (
            store.selectedContentType() === 'series' ||
            isStalkerSeriesFlag(item.is_series) ||
            Boolean(item.series?.length)
        ) {
            return {
                watchState: resolvePortalSeriesWatchState(hasSeriesProgress),
            };
        }
        const position =
            owner() === current() ? rows().get(`vod_${id}`) : undefined;
        return {
            progress: getPortalPlaybackProgressPercent(position),
            watchState: resolvePortalWatchState(position),
        };
    }

    return { loadState, hasSnapshot: ownsSnapshot, refresh, getItemProgress };
}
