import {
    computed,
    inject,
    Injectable,
    Injector,
    linkedSignal,
    signal,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { sortPortalChannelItems } from '@iptvnator/portal/shared/util';
import {
    FavoritesService,
    XtreamFullEpgService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    EpgSourceSettingsService,
    injectTranslationTick,
    ParentalLockService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    EpgProgram,
    foldSearchText,
    isCatalogUnavailable,
} from '@iptvnator/shared/interfaces';
import type {
    EpgGuideChannel,
    EpgGuideScope,
    EpgGuideSearchHit,
    EpgGuideSearchUpdate,
    EpgGuideSource,
    EpgGuideWindow,
} from '@iptvnator/ui/epg';
import { toSharedEpgProgram } from '../portal-channels-list/epg-preview-program';
import { XtreamGuideScheduleCache } from './xtream-guide-schedule-cache';
import {
    XtreamLiveChannelItem,
    XtreamLiveChannelNavigationService,
} from './xtream-live-channel-navigation.service';

const ALL = 'all';
const FAVORITES = 'favorites';
const SEARCH_LIMIT = 20;

function name(item: XtreamLiveChannelItem): string {
    return item.title || item.name || '';
}

function categoryKey(id: string | number | null | undefined): string {
    const raw = String(id ?? '').trim();
    const numeric = Number(raw);
    return raw && Number.isFinite(numeric) ? String(numeric) : raw;
}

function rowsByStreamId(
    items: readonly XtreamLiveChannelItem[]
): Map<string, XtreamLiveChannelItem> {
    const rows = new Map<string, XtreamLiveChannelItem>();
    for (const item of items) {
        const id = String(item.xtream_id);
        if (!rows.has(id)) rows.set(id, item);
    }
    return rows;
}

function overlaps(program: EpgProgram, window: EpgGuideWindow): boolean {
    const start = program.startTimestamp
        ? program.startTimestamp * 1000
        : Date.parse(program.start);
    const stop = program.stopTimestamp
        ? program.stopTimestamp * 1000
        : Date.parse(program.stop);
    return stop > start && start < window.toMs && stop > window.fromMs;
}

@Injectable()
export class XtreamEpgGuideSourceService implements EpgGuideSource {
    private readonly store = inject(XtreamStore);
    private readonly settings = inject(SettingsStore);
    private readonly sources = inject(EpgSourceSettingsService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly injector = inject(Injector);
    private readonly favoritesService = inject(FavoritesService);
    private readonly navigation = inject(XtreamLiveChannelNavigationService);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();
    private readonly cache = new XtreamGuideScheduleCache();
    private cacheRevision: unknown;
    private session = new AbortController();
    private readonly favorites = signal<ReadonlyMap<number, number>>(new Map());

    readonly deferredCoverage = true;
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
            name
        );
    });

    private readonly catalog = computed(() => rowsByStreamId(this.items()));

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
        source: () => this.playlist()?.id,
        computation: () => ALL,
    });

    private readonly scopedRows = computed(() => {
        const scope = this.scopeId();
        if (scope === ALL) return this.catalog();
        const items = this.items();
        if (scope === FAVORITES) {
            const favorites = this.favorites();
            const sqlite = this.runtime.supportsXtreamSqliteDataSource;
            return rowsByStreamId(
                items.filter(
                    (item) =>
                        favorites.get(item.xtream_id) ===
                        Number(sqlite ? item.id : (item.category_id ?? 0))
                )
            );
        }
        return rowsByStreamId(
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
            name: name(item),
            logoUrl: item.poster_url || item.stream_icon || null,
            epgKey: String(item.xtream_id),
        }))
    );

    readonly activeChannelId = computed(() => {
        const id = this.navigation.activeItem()?.xtream_id;
        return id ? String(id) : null;
    });
    private readonly live = signal(true);
    readonly livePlayback = this.live.asReadonly();
    private play?: (
        item: XtreamLiveChannelItem,
        scope: readonly XtreamLiveChannelItem[]
    ) => void;

    bind(play: NonNullable<XtreamEpgGuideSourceService['play']>): void {
        this.play = play;
    }

    setLivePlayback(live: boolean): void {
        this.live.set(live);
    }

    open(): void {
        this.close();
        this.session = new AbortController();
        const signal = this.session.signal;
        const playlistId = this.playlist()?.id;
        this.setScope(categoryKey(this.store.selectedCategoryId()) || ALL);
        if (playlistId) {
            void firstValueFrom(
                this.favoritesService.getFavorites(playlistId)
            ).then(
                (items) => {
                    if (!signal.aborted && this.playlist()?.id === playlistId) {
                        const favorites = new Map<number, number>();
                        for (const item of items) {
                            if (
                                item.type === 'live' &&
                                item.content_id != null &&
                                !isCatalogUnavailable({
                                    catalogStatus: item.catalog_status,
                                })
                            ) {
                                favorites.set(
                                    item.xtream_id,
                                    this.runtime.supportsXtreamSqliteDataSource
                                        ? item.content_id
                                        : item.category_id
                                );
                            }
                        }
                        this.favorites.set(favorites);
                    }
                },
                () => undefined
            );
        }
    }

    close(): void {
        this.session.abort();
        this.cache.clear();
        this.favorites.set(new Map());
        this.scopeId.set(ALL);
    }

    setScope(id: string): void {
        if (this.scopes().some((scope) => scope.id === id))
            this.scopeId.set(id);
    }

    activate(id: string): void {
        if (this.session.signal.aborted) return;
        const item = this.scopedRows().get(id);
        if (item) this.play?.(item, this.scopedItems());
    }

    async loadPrograms(
        window: EpgGuideWindow
    ): Promise<Map<string, EpgProgram[]>> {
        const { read } = this.scheduleReader(window.signal);
        const rows = this.scopedRows();
        const results = await Promise.all(
            window.channels.map(async ({ id }) => {
                try {
                    return [
                        id,
                        (await read(rows.get(id))).filter((program) =>
                            overlaps(program, window)
                        ),
                    ] as const;
                } catch {
                    return null;
                }
            })
        );
        return new Map(
            results.filter(
                (result): result is NonNullable<typeof result> =>
                    result !== null
            )
        );
    }

    async loadCoverage(window: EpgGuideWindow): Promise<Set<string>> {
        const { read, checkCurrent } = this.scheduleReader(window.signal);
        const rows = this.scopedRows();
        const covered = new Set<string>();
        for (const { id } of window.channels) {
            const programs = await read(rows.get(id)).catch(() => {
                checkCurrent();
                return null;
            });
            if (
                !programs ||
                programs.some((program) => overlaps(program, window))
            )
                covered.add(id);
        }
        return covered;
    }

    async searchPrograms(
        query: string,
        signal?: AbortSignal,
        report?: (update: EpgGuideSearchUpdate) => void
    ): Promise<EpgGuideSearchHit[]> {
        const { read, checkCurrent } = this.scheduleReader(signal);
        const term = foldSearchText(query);
        const scoped = this.scopedRows();
        const catalog = this.catalog();
        const hits: EpgGuideSearchHit[] = [];
        let checked = 0;
        let failed = false;
        for (const [id, item] of catalog) {
            const channel = scoped.get(id) ?? item;
            const programs = await read(channel).catch(() => {
                checkCurrent();
                failed = true;
                return [];
            });
            for (const program of programs) {
                if (
                    !foldSearchText(
                        `${program.title} ${program.desc ?? ''}`
                    ).includes(term)
                )
                    continue;
                hits.push({
                    channelId: id,
                    channelName: name(channel),
                    program,
                });
                if (hits.length === SEARCH_LIMIT) break;
            }
            checked++;
            report?.({ matches: hits.slice(), checked, total: catalog.size });
            if (hits.length === SEARCH_LIMIT) break;
        }
        if (failed && !hits.length)
            throw new Error(
                'Programme search could not check the full catalogue'
            );
        return hits;
    }

    private scheduleReader(signal?: AbortSignal) {
        const revision = this.revision();
        const session = this.session.signal;
        if (this.cacheRevision !== revision) {
            this.cacheRevision = revision;
            this.cache.clear();
        }
        const checkCurrent = () => {
            signal?.throwIfAborted();
            session.throwIfAborted();
            if (revision !== this.revision())
                throw new DOMException('EPG source changed', 'AbortError');
        };
        const read = async (item: XtreamLiveChannelItem | undefined) => {
            const playlist = revision.playlist;
            if (!playlist || !item) return [];
            const programs = await this.cache.load(
                `${item.xtream_id}:${item.epg_channel_id ?? ''}`,
                checkCurrent,
                async () =>
                    (
                        await this.injector
                            .get(XtreamFullEpgService)
                            .load(
                                playlist,
                                item.xtream_id,
                                item.epg_channel_id ?? null
                            )
                    ).map(toSharedEpgProgram)
            );
            checkCurrent();
            return programs;
        };
        return { read, checkCurrent };
    }
}
