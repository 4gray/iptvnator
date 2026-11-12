import {
    computed,
    inject,
    Injectable,
    linkedSignal,
    signal,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { sortPortalChannelItems } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    EpgSourceSettingsService,
    injectTranslationTick,
    ParentalLockService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { EpgProgram, foldSearchText } from '@iptvnator/shared/interfaces';
import { applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';
import type {
    EpgGuideChannel,
    EpgGuideScope,
    EpgGuideSearchHit,
    EpgGuideSearchUpdate,
    EpgGuideSource,
    EpgGuideWindow,
} from '@iptvnator/ui/epg';
import { injectXtreamGuideFavorites } from './xtream-guide-favorites';
import { createXtreamGuideNowPlaying } from './xtream-guide-now-playing';
import {
    injectXtreamGuideSchedules,
    scheduleKey,
    programmeOverlapsGuideWindow,
    isNewGuideSearchMatch,
} from './xtream-guide-schedules';
import {
    xtreamCategoryKey as categoryKey,
    sameXtreamChannelCopy,
    xtreamRowsByStreamId,
    XtreamLiveChannelItem,
    XtreamLiveChannelNavigationService,
} from './xtream-live-channel-navigation.service';

const ALL = 'all';
const FAVORITES = 'favorites';
const SEARCH_LIMIT = 20;

function channelName(item: XtreamLiveChannelItem): string {
    return item.title || item.name || '';
}

function channelEpgKey(item: XtreamLiveChannelItem): string {
    return `${categoryKey(item.category_id)}:${scheduleKey(item)}`;
}

@Injectable()
export class XtreamEpgGuideSourceService implements EpgGuideSource {
    private readonly store = inject(XtreamStore);
    private readonly settings = inject(SettingsStore);
    private readonly sources = inject(EpgSourceSettingsService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly navigation = inject(XtreamLiveChannelNavigationService);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();
    private readonly session = signal<AbortController | null>(null);

    readonly deferredCoverage = true;
    readonly searchAcrossScopes = true;
    readonly numberByDisplayedOrder = true;
    readonly programBatchSize = 1;
    readonly playlist = this.store.currentPlaylist;
    private readonly categories = computed(() => {
        const playlistId = this.playlist()?.id;
        this.parentalLock.version();
        if (!playlistId || this.store.selectedContentType() !== 'live')
            return [];
        return this.store.getCategoriesBySelectedType().filter((category) => {
            if ('hidden' in category && category.hidden) return false;
            const id =
                this.runtime.supportsXtreamSqliteDataSource &&
                'xtream_id' in category
                    ? category['xtream_id']
                    : (category.category_id ?? category.id);
            if (!Number.isSafeInteger(Number(id)) && this.parentalLock.active())
                return false;
            return !this.parentalLock.isXtreamCategoryLocked(
                playlistId,
                'live',
                Number(id)
            );
        });
    });

    private readonly items = computed(() => {
        const playlist = this.playlist();
        if (!playlist || this.store.selectedContentType() !== 'live') return [];
        const streams =
            this.store.liveStreams() as unknown as XtreamLiveChannelItem[];
        const categories = new Set(
            this.categories().map((category) =>
                categoryKey(category.category_id ?? category.id)
            )
        );
        const sqlite = this.runtime.supportsXtreamSqliteDataSource;
        this.parentalLock.version();
        return sortPortalChannelItems(
            streams.filter((item) => {
                const key = categoryKey(item.category_id);
                return sqlite
                    ? categories.has(key)
                    : !this.parentalLock.isXtreamCategoryLocked(
                          playlist.id,
                          'live',
                          key ? Number(key) : NaN
                      );
            }),
            this.navigation.sortMode(),
            channelName
        );
    });

    private readonly favorites = injectXtreamGuideFavorites(
        this.session,
        () => this.playlist()?.id,
        this.items,
        () => this.runtime.supportsXtreamSqliteDataSource
    );
    private readonly catalog = computed(() =>
        xtreamRowsByStreamId(this.items())
    );

    readonly revision = computed(() => ({
        playlist: this.playlist(),
        sources: this.sources.revision(),
        preferUploaded: this.settings.preferUploadedEpgOverXtream?.(),
        catalog: this.catalog(),
    }));

    readonly scopes = computed<EpgGuideScope[]>(() => {
        this.languageTick();
        return [
            {
                id: ALL,
                label: this.translate.instant('CHANNELS.ALL_CHANNELS'),
                kind: 'all',
            },
            {
                id: FAVORITES,
                label: this.translate.instant('CHANNELS.FAVORITES'),
                kind: 'favorites',
            },
            ...this.categories().map((category) => ({
                id: categoryKey(category.category_id ?? category.id),
                label: category.category_name ?? category.name ?? '',
                kind: 'group' as const,
            })),
        ];
    });

    readonly scopeId = linkedSignal({
        source: () => ({ id: this.playlist()?.id, scopes: this.scopes() }),
        computation: ({ id, scopes }, previous): string =>
            previous &&
            previous.source.id === id &&
            scopes.some((scope) => scope.id === previous.value)
                ? previous.value
                : ALL,
    });

    private readonly scopedRows = computed(() => {
        const scope = this.scopeId();
        if (scope === ALL) return this.catalog();
        const items = this.items();
        if (scope === FAVORITES) {
            const favorites = this.favorites();
            return xtreamRowsByStreamId(
                items.filter((item) => favorites.get(item.xtream_id) === item)
            );
        }
        return xtreamRowsByStreamId(
            items.filter((item) => categoryKey(item.category_id) === scope)
        );
    });

    private readonly scopedItems = computed(() => [
        ...this.scopedRows().values(),
    ]);

    readonly channels = computed<EpgGuideChannel[]>(() =>
        this.scopedItems().map((item, index) => ({
            id: String(item.xtream_id),
            number: index + 1,
            name: this.displayChannelName(item),
            logoUrl: item.poster_url || item.stream_icon || null,
            epgKey: channelEpgKey(item),
        }))
    );

    private readonly playback = signal({
        item: null as XtreamLiveChannelItem | null,
        live: true,
    });
    readonly activeChannelId = computed(() => {
        const item = this.playback().item;
        if (!item) return null;
        const id = String(item.xtream_id);
        const row = this.scopedRows().get(id);
        return row && sameXtreamChannelCopy(row, item) ? id : null;
    });
    isChannelVisible = (epgKey: string) =>
        this.items().some((item) => channelEpgKey(item) === epgKey);
    readonly livePlayback = computed(() => this.playback().live);
    readonly closeOnPlaybackConfirmation = true;
    readonly playingItem = computed(() => {
        const item = this.playback().item;
        return item
            ? this.items().find((row) => sameXtreamChannelCopy(row, item))
            : undefined;
    });
    private readonly schedules = injectXtreamGuideSchedules(
        this.revision,
        this.session,
        (key, revision, schedule) => this.dock.publish(key, revision, schedule)
    );
    private readonly dock = createXtreamGuideNowPlaying(
        computed(() => {
            const item = this.playingItem();
            return item ? scheduleKey(item) : null;
        }),
        this.revision,
        this.session,
        () =>
            this.session() && this.livePlayback()
                ? this.playingItem()
                : undefined,
        (item, signal) => this.schedules.reader(signal).read(item),
        this.schedules.expiresAt
    );
    readonly playingSchedule = this.dock.programs;
    readonly playingScheduleItems = this.dock.items;
    readonly activePlayingScheduleItems = this.dock.activeItems;
    readonly recoveredPrograms = this.dock.recoveredPrograms;
    readonly playbackSchedule = this.schedules.forPlayback;
    private play?: (
        item: XtreamLiveChannelItem,
        scope: readonly XtreamLiveChannelItem[],
        retry?: boolean,
        onConfirmed?: () => void
    ) => void;
    private canRetryUnverified?: () => boolean;
    canRetuneActive?: (watchLive?: boolean) => boolean;

    private displayChannelName(item: XtreamLiveChannelItem): string {
        return applyChannelNameStrip(
            channelName(item),
            this.settings.stripCountryPrefix?.()
        );
    }

    bind(
        play: NonNullable<XtreamEpgGuideSourceService['play']>,
        canRetryUnverified?: () => boolean,
        canRetuneActive?: (watchLive?: boolean) => boolean
    ): void {
        this.play = play;
        this.canRetryUnverified = canRetryUnverified;
        this.canRetuneActive = canRetuneActive;
    }

    setPlayback(item: XtreamLiveChannelItem | null, live: boolean): void {
        this.playback.set({ item, live });
    }

    open(): void {
        this.close();
        this.session.set(new AbortController());
        this.setScope(categoryKey(this.store.selectedCategoryId()) || ALL);
    }

    close(): void {
        this.session()?.abort();
        this.session.set(null);
        this.schedules.clear();
        this.favorites.set(new Map());
        this.scopeId.set(ALL);
    }

    setScope(id: string): void {
        if (this.scopes().some((scope) => scope.id === id))
            this.scopeId.set(id);
    }

    activate(
        id: string,
        epgKey?: string | null,
        displayed?: readonly EpgGuideChannel[],
        onConfirmed?: () => void
    ): void {
        if (!this.session()) return;
        const scoped = this.scopedRows().get(id);
        const exact =
            !epgKey || (scoped && channelEpgKey(scoped) === epgKey)
                ? scoped
                : this.items().find(
                      (item) =>
                          String(item.xtream_id) === id &&
                          channelEpgKey(item) === epgKey
                  );
        if (!exact) return;
        const queue = exact === scoped ? this.visibleItems(displayed) : [exact];
        if (onConfirmed) this.play?.(exact, queue, false, onConfirmed);
        else this.play?.(exact, queue);
    }

    retryActive(
        channel: EpgGuideChannel,
        displayed?: readonly EpgGuideChannel[],
        onConfirmed?: () => void
    ): boolean {
        if (
            !this.session() ||
            !this.livePlayback() ||
            channel.id !== this.activeChannelId() ||
            !this.canRetryUnverified?.() ||
            !this.play
        )
            return false;
        const item = this.scopedRows().get(channel.id);
        if (!item || channelEpgKey(item) !== channel.epgKey) return false;
        const queue = this.visibleItems(displayed);
        if (onConfirmed) this.play(item, queue, true, onConfirmed);
        else this.play(item, queue, true);
        return true;
    }

    private visibleItems(displayed?: readonly EpgGuideChannel[]) {
        if (!displayed) return this.scopedItems();
        const scope = this.scopedRows();
        return displayed.reduce<XtreamLiveChannelItem[]>((items, row) => {
            const item = scope.get(row.id);
            if (item && channelEpgKey(item) === row.epgKey) items.push(item);
            return items;
        }, []);
    }

    loadPrograms(window: EpgGuideWindow): Promise<Map<string, EpgProgram[]>> {
        return this.schedules.loadWindow(window, this.scopedRows());
    }

    programsExpireAt = (id: string): number =>
        this.schedules.expiresAt(this.scopedRows().get(id));

    async loadCoverage(
        window: EpgGuideWindow,
        reportPrograms?: (
            channelId: string,
            programs: EpgProgram[] | null
        ) => void
    ): Promise<Set<string>> {
        const { read, checkCurrent } = this.schedules.reader(window.signal);
        const rows = this.scopedRows();
        const covered = new Set<string>();
        for (const { id } of window.channels) {
            const programs = await read(rows.get(id)).catch(() => {
                checkCurrent();
                return null;
            });
            const matches = programs?.filter((item) =>
                programmeOverlapsGuideWindow(item, window)
            );
            if (!matches || matches.length) covered.add(id);
            reportPrograms?.(id, matches ?? null);
        }
        return covered;
    }

    async searchPrograms(
        query: string,
        signal?: AbortSignal,
        report?: (update: EpgGuideSearchUpdate) => void
    ): Promise<EpgGuideSearchHit[]> {
        const { read, checkCurrent } = this.schedules.reader(signal);
        const term = foldSearchText(query);
        const catalog = new Map<string, XtreamLiveChannelItem>();
        for (const rows of [this.scopedItems(), this.items()]) {
            for (const item of rows) {
                const key = scheduleKey(item);
                if (!catalog.has(key)) catalog.set(key, item);
            }
        }
        const hits: EpgGuideSearchHit[] = [];
        let checked = 0;
        let failed = false;
        for (const channel of catalog.values()) {
            const programs = await read(channel).catch(() => {
                checkCurrent();
                failed = true;
                return [];
            });
            const channelId = String(channel.xtream_id);
            for (const program of programs) {
                if (!isNewGuideSearchMatch(channelId, program, term, hits))
                    continue;
                hits.push({
                    channelId,
                    channelEpgKey: channelEpgKey(channel),
                    channelName: this.displayChannelName(channel),
                    program,
                });
                if (hits.length === SEARCH_LIMIT) break;
            }
            checked++;
            report?.({ matches: hits.slice(), checked, total: catalog.size });
            if (hits.length === SEARCH_LIMIT) break;
        }
        if (failed && !hits.length)
            throw new Error('Programme search could not check the catalogue');
        return hits;
    }
}
