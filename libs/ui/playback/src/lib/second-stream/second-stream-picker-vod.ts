import { inject, signal } from '@angular/core';
import {
    SecondStreamVodService,
    type SecondStreamEpisode,
    type SecondStreamVodType,
    type SecondStreamVodPage,
} from '@iptvnator/portal/shared/data-access';
import {
    getPortalPlaybackProgressPercent,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';

/** Dialog-local browse and episode drill-down. Playback stays with the host. */
export class SecondStreamPickerVod {
    readonly service = inject(SecondStreamVodService);
    readonly type = signal<SecondStreamVodType | null>(null);
    readonly series = signal<UnifiedCollectionItem | null>(null);
    readonly items = signal<UnifiedCollectionItem[]>([]);
    readonly episodes = signal<SecondStreamEpisode[]>([]);
    readonly loading = signal(false);
    readonly failed = signal(false);
    readonly hasMore = signal(false);
    readonly episodeProgress = (row: SecondStreamEpisode) =>
        getPortalPlaybackProgressPercent(row.position);
    private request?: AbortController;
    private playlistId = '';
    private query = '';
    private page = 0;
    private readonly seenPages = new Set<string>();
    private readonly exhaustedCatalogs = new Set<
        NonNullable<SecondStreamVodPage['exhaustedCatalogs']>[number]
    >();
    private searchTimer?: ReturnType<typeof setTimeout>;

    async browse(
        playlistId: string,
        type: SecondStreamVodType,
        query = ''
    ): Promise<void> {
        this.cancel();
        this.playlistId = playlistId;
        this.query = query;
        this.type.set(type);
        this.series.set(null);
        this.items.set([]);
        this.hasMore.set(false);
        this.page = 0;
        this.seenPages.clear();
        this.exhaustedCatalogs.clear();
        await this.more();
    }

    search(playlistId: string, type: SecondStreamVodType, query: string): void {
        this.cancel();
        this.loading.set(true);
        this.searchTimer = setTimeout(
            () => void this.browse(playlistId, type, query),
            250
        );
    }

    async more(): Promise<void> {
        const type = this.type();
        if (!type || this.loading()) return;
        const page = this.page + 1;
        await this.load(
            (signal) =>
                this.service.browse(
                    this.playlistId,
                    type,
                    signal,
                    this.query,
                    page,
                    this.seenPages,
                    this.exhaustedCatalogs
                ),
            (result) => {
                const alreadyLoaded = new Set(
                    this.items().map((item) => item.uid)
                );
                this.items.update((items) => [
                    ...items,
                    ...result.items.filter(
                        (item) => !alreadyLoaded.has(item.uid)
                    ),
                ]);
                for (const key of result.pageKeys ?? [])
                    this.seenPages.add(key);
                for (const catalog of result.exhaustedCatalogs ?? [])
                    this.exhaustedCatalogs.add(catalog);
                this.hasMore.set(result.hasMore);
                this.page = page;
            }
        );
    }

    async openSeries(series: UnifiedCollectionItem): Promise<void> {
        this.cancel();
        this.series.set(series);
        this.episodes.set([]);
        await this.load(
            (signal) => this.service.episodes(series, signal),
            (result) => this.episodes.set(result)
        );
    }

    retry(): void {
        const series = this.series();
        if (series) void this.openSeries(series);
        else void this.more();
    }

    back(): void {
        this.cancel();
        this.series.set(null);
    }

    reset(): void {
        this.back();
        this.type.set(null);
        this.items.set([]);
        this.hasMore.set(false);
    }

    cancel(): void {
        clearTimeout(this.searchTimer);
        this.request?.abort();
        this.loading.set(false);
        this.failed.set(false);
    }

    private async load<T>(
        fetch: (signal: AbortSignal) => Promise<T>,
        apply: (result: T) => void
    ): Promise<void> {
        const request = new AbortController();
        this.request = request;
        this.failed.set(false);
        this.loading.set(true);
        try {
            const result = await fetch(request.signal);
            if (!request.signal.aborted) apply(result);
        } catch {
            if (!request.signal.aborted) this.failed.set(true);
        } finally {
            if (!request.signal.aborted) this.loading.set(false);
        }
    }
}
