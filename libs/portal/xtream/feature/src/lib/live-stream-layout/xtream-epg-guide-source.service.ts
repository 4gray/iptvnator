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
import { EpgProgram, foldSearchText } from '@iptvnator/shared/interfaces';
import type {
    EpgGuideChannel,
    EpgGuideScope,
    EpgGuideSearchHit,
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
    private readonly favorites = signal<ReadonlySet<number>>(new Set());

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

    private readonly catalog = computed(() => {
        const categories = new Set(
            this.categories().map((category) =>
                Number(category.category_id ?? category.id)
            )
        );
        const streams =
            this.store.liveStreams() as unknown as XtreamLiveChannelItem[];
        const items = sortPortalChannelItems(
            streams.filter((item) => categories.has(Number(item.category_id))),
            this.navigation.sortMode(),
            name
        );
        return new Map(items.map((item) => [String(item.xtream_id), item]));
    });

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
                id: String(category.category_id ?? category.id),
                label: category.category_name ?? category.name ?? '',
                kind: 'group' as const,
            })),
        ];
    });

    readonly scopeId = linkedSignal({
        source: () => this.playlist()?.id,
        computation: () => ALL,
    });

    private readonly scopedItems = computed(() => {
        const scope = this.scopeId();
        const items = [...this.catalog().values()];
        if (scope === ALL) return items;
        if (scope === FAVORITES)
            return items.filter((item) => this.favorites().has(item.xtream_id));
        return items.filter((item) => String(item.category_id) === scope);
    });

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
        this.setScope(String(this.store.selectedCategoryId() ?? ALL));
        if (playlistId) {
            void firstValueFrom(
                this.favoritesService.getFavorites(playlistId)
            ).then(
                (items) => {
                    if (!signal.aborted && this.playlist()?.id === playlistId) {
                        this.favorites.set(
                            new Set(
                                items
                                    .filter((item) => item.type === 'live')
                                    .map((item) => item.xtream_id)
                            )
                        );
                    }
                },
                () => undefined
            );
        }
    }

    close(): void {
        this.session.abort();
        this.cache.clear();
        this.favorites.set(new Set());
        this.scopeId.set(ALL);
    }

    setScope(id: string): void {
        if (this.scopes().some((scope) => scope.id === id))
            this.scopeId.set(id);
    }

    activate(id: string): void {
        if (this.session.signal.aborted) return;
        const item = this.catalog().get(id);
        if (item) this.play?.(item, this.scopedItems());
    }

    async loadPrograms(
        window: EpgGuideWindow
    ): Promise<Map<string, EpgProgram[]>> {
        const load = this.scheduleReader(window.signal);
        const results = await Promise.all(
            window.channels.map(async ({ id }) => {
                try {
                    return [
                        id,
                        (await load(id)).filter((program) =>
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
        const load = this.scheduleReader(window.signal);
        const covered = new Set<string>();
        for (const { id } of window.channels) {
            if ((await load(id)).some((program) => overlaps(program, window)))
                covered.add(id);
        }
        return covered;
    }

    async searchPrograms(
        query: string,
        signal?: AbortSignal
    ): Promise<EpgGuideSearchHit[]> {
        const load = this.scheduleReader(signal);
        const term = foldSearchText(query);
        const visible = new Set(this.channels().map((channel) => channel.id));
        const hits: EpgGuideSearchHit[] = [];
        for (const [id, item] of this.catalog()) {
            for (const program of await load(id)) {
                if (
                    !foldSearchText(
                        `${program.title} ${program.desc ?? ''}`
                    ).includes(term)
                )
                    continue;
                hits.push({
                    channelId: visible.has(id) ? id : null,
                    channelName: name(item),
                    program,
                });
                if (hits.length === SEARCH_LIMIT) return hits;
            }
        }
        return hits;
    }

    private scheduleReader(
        signal?: AbortSignal
    ): (id: string) => Promise<EpgProgram[]> {
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
        return async (id) => {
            const item = revision.catalog.get(id);
            const playlist = revision.playlist;
            if (!playlist || !item) return [];
            const programs = await this.cache.load(
                item.xtream_id,
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
    }
}
