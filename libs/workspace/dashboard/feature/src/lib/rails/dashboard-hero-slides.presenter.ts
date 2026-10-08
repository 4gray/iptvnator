import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    linkedSignal,
    signal,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    isPortalPlaybackWatched,
    splitSeasonSuffix,
} from '@iptvnator/portal/shared/util';
import {
    playlistDisplayLabel,
    resolvePortalActivityWatchKind,
    type PlaybackPositionData,
    type PortalActivityItem,
} from '@iptvnator/shared/interfaces';
import { DashboardDataService } from '@iptvnator/workspace/dashboard/data-access';
import {
    DashboardHeroTmdbService,
    type DashboardHeroTmdbExtras,
} from './dashboard-hero-tmdb.service';
import {
    dashboardHeroHue,
    resolveDashboardHeroArtwork,
    type DashboardHeroAction,
    type DashboardHeroSlide,
} from './dashboard-hero.utils';
import {
    dashboardHeroItemKey,
    pickDashboardHeroSources,
    type DashboardHeroSource,
} from './dashboard-hero-slides.utils';
import { DashboardLiveEpgPresenter } from './dashboard-live-epg.presenter';
import type { DashboardLiveEpgDetails } from './dashboard-live-epg.utils';
import {
    buildDashboardEpisodeBadge,
    formatRemainingLabel,
    playbackProgressPercent,
} from './dashboard-playback.utils';

const TYPE_LABEL_KEYS = {
    live: 'WORKSPACE.DASHBOARD.TYPE_LIVE',
    movie: 'WORKSPACE.DASHBOARD.TYPE_MOVIE',
    series: 'WORKSPACE.DASHBOARD.TYPE_SERIES',
} as const;

/**
 * How long, from the hero's creation, its skeleton may wait for the first
 * programme of a live candidate. Portal answers usually take a few hundred
 * milliseconds; an unreachable portal must not hold the skeleton forever.
 */
export const DASHBOARD_HERO_LIVE_ANSWER_WAIT_MS = 2000;

const PROVIDER_LABEL_KEYS = {
    xtream: 'WORKSPACE.DASHBOARD.XTREAM',
    stalker: 'WORKSPACE.DASHBOARD.STALKER',
    m3u: 'WORKSPACE.DASHBOARD.M3U',
} as const;

/**
 * Builds the cinematic hero's rotation slides from the dashboard data:
 * which titles are featured (`pickDashboardHeroSources`), their artwork,
 * TMDB extras, playback progress, live programme and actions.
 *
 * Component-provided next to the hero; the live programme answers come from
 * the page's `DashboardLiveEpgPresenter`, which already pins the hero's live
 * candidates. TMDB extras are fetched per featured title after first paint,
 * memoized by `DashboardHeroTmdbService`, and vanish immediately when the
 * user opts out of TMDB mid-session.
 */
@Injectable()
export class DashboardHeroSlidesPresenter {
    private readonly data = inject(DashboardDataService);
    private readonly liveEpg = inject(DashboardLiveEpgPresenter);
    private readonly heroTmdb = inject(DashboardHeroTmdbService);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    private readonly failedImages = signal<Record<string, true>>({});
    private readonly tmdbExtras = signal<
        ReadonlyMap<string, DashboardHeroTmdbExtras | null>
    >(new Map());
    private readonly requestedTmdbKeys = new Set<string>();

    private readonly liveAnswerWaitOver = signal(false);

    /**
     * Nothing to feature yet and a source that can feature a title is still
     * on its first load. Every such source counts, not only the history:
     * the Xtream recently-added query waits for the favorites, and a live
     * slide waits for its programme, so dropping the skeleton when the
     * history resolved empty removed the hero and inserted it again moments
     * later, moving every rail below twice. Once the skeleton has gone it
     * does not come back: a later reload must not shift the page either.
     */
    readonly loading = linkedSignal<boolean, boolean>({
        source: () =>
            this.slides().length === 0 &&
            (this.data.globalRecentLoading() ||
                this.data.globalFavoritesLoading() ||
                this.data.xtreamRecentlyAddedLoading() ||
                (!this.liveAnswerWaitOver() &&
                    this.liveEpg.heroLiveAwaitingFirstAnswer())),
        computation: (loading, previous) =>
            previous?.value === false ? false : loading,
    }).asReadonly();

    /** The first candidate channel with a programme on air right now. */
    private readonly liveSlide = computed(() => {
        for (const candidate of this.liveEpg.heroLiveCandidates()) {
            const details = this.liveEpg.heroDetailsFor(candidate.item);
            if (details?.nowPlayingTitle) {
                return { candidate, details };
            }
        }
        return null;
    });

    private readonly sources = computed(() =>
        pickDashboardHeroSources({
            continueItems: this.data
                .globalRecentVodItems()
                .filter(
                    (item) =>
                        !isPortalPlaybackWatched(
                            this.data.getPlaybackPositionForItem(item)
                        )
                ),
            live: this.liveSlide()?.candidate ?? null,
            reserveLive: this.liveEpg.heroLiveCandidates().length > 0,
            favorites: this.data
                .globalFavoriteItems()
                .filter(
                    (item) => item.type === 'movie' || item.type === 'series'
                ),
            recentlyAdded: this.data.xtreamRecentlyAddedItems(),
            mostRecent: this.data.globalRecentItems()[0] ?? null,
        })
    );

    readonly slides = computed<DashboardHeroSlide[]>(() => {
        this.languageTick();
        const liveDetails = this.liveSlide()?.details ?? null;
        return this.sources().map((source) =>
            this.toSlide(source, liveDetails)
        );
    });

    constructor() {
        const liveAnswerWait = setTimeout(
            () => this.liveAnswerWaitOver.set(true),
            DASHBOARD_HERO_LIVE_ANSWER_WAIT_MS
        );
        inject(DestroyRef).onDestroy(() => clearTimeout(liveAnswerWait));

        effect(() => {
            if (!this.heroTmdb.isEnabled()) {
                return;
            }
            // Keys read here, tracked: they carry the TMDB language, so a
            // language change loads the localized overview and genres.
            const requests = this.sources()
                .map((source) => source.item)
                .filter((item) => item.type !== 'live')
                .map((item) => ({ item, key: this.heroTmdb.keyFor(item) }));
            untracked(() =>
                requests.forEach(({ item, key }) =>
                    this.loadTmdbExtras(item, key)
                )
            );
        });
    }

    markImageFailed(url: string): void {
        this.failedImages.update((state) =>
            state[url] ? state : { ...state, [url]: true }
        );
    }

    private loadTmdbExtras(item: PortalActivityItem, key: string): void {
        if (this.requestedTmdbKeys.has(key)) {
            return;
        }
        this.requestedTmdbKeys.add(key);
        void this.heroTmdb.getExtras(item).then((extras) => {
            this.tmdbExtras.update((state) => new Map(state).set(key, extras));
        });
    }

    private toSlide(
        source: DashboardHeroSource,
        liveDetails: DashboardLiveEpgDetails | null
    ): DashboardHeroSlide {
        const item = source.item;
        const isLive = item.type === 'live';
        // Single reactive read, gated on the TMDB opt-in
        const extras =
            !isLive && this.heroTmdb.isEnabled()
                ? (this.tmdbExtras().get(this.heroTmdb.keyFor(item)) ?? null)
                : null;
        const details =
            source.kind === 'live'
                ? liveDetails
                : isLive
                  ? this.liveEpg.heroDetailsFor(item)
                  : null;
        const position = isLive
            ? null
            : this.data.getPlaybackPositionForItem(item);
        const artwork = resolveDashboardHeroArtwork(
            {
                backdropUrl: item.backdrop_url || extras?.backdropUrl || null,
                posterUrl: item.poster_url,
            },
            this.failedImages()
        );

        // Watch kind: a Stalker embedded-VOD show routes as a movie
        const watchKind = isLive
            ? 'live'
            : (resolvePortalActivityWatchKind(item) ?? item.type);
        const episodeBadge = buildDashboardEpisodeBadge(
            item,
            position,
            (key, params) => this.translate.instant(key, params)
        );
        return {
            ...artwork,
            id: `${source.kind}:${dashboardHeroItemKey(item)}`,
            kind: source.kind,
            contentType: item.type,
            // "Большая фарма (1 сезон)" → "Большая фарма" only while the
            // episode badge names the season; without a badge the marker is
            // the sole season identity of a per-season catalog entry. A movie
            // keeps its name as is.
            title:
                watchKind === 'series' && episodeBadge
                    ? splitSeasonSuffix(item.title).title
                    : item.title,
            typeLabelKey: TYPE_LABEL_KEYS[watchKind],
            reasonLabelKey: this.reasonLabelKey(source),
            episodeBadge,
            rating: extras?.rating ?? null,
            genres: extras?.genres ?? [],
            year: extras?.year ?? item.release_year ?? null,
            source: playlistDisplayLabel(
                item.playlist_name,
                this.translate.instant(
                    item.source
                        ? PROVIDER_LABEL_KEYS[item.source]
                        : 'WORKSPACE.DASHBOARD.PROVIDER'
                )
            ),
            programmeTitle: details?.nowPlayingTitle ?? null,
            category: details?.nowPlayingCategory ?? null,
            timeRange: details?.nowPlayingTimeRange ?? null,
            description: isLive
                ? (details?.nowPlayingDescription ?? null)
                : (extras?.overview ?? null),
            progress: isLive
                ? (details?.nowPlayingProgress ?? null)
                : playbackProgressPercent(position),
            accentHue: dashboardHeroHue(item.title),
            ...this.actionsFor(source, position),
        };
    }

    private reasonLabelKey(source: DashboardHeroSource): string {
        switch (source.kind) {
            case 'continue':
                return 'WORKSPACE.DASHBOARD.CONTINUE_WATCHING';
            case 'live':
                return source.origin === 'favorite'
                    ? 'WORKSPACE.DASHBOARD.HERO_FAVORITE_CHANNEL'
                    : 'WORKSPACE.DASHBOARD.RECENTLY_WATCHED';
            case 'favorite':
                return 'WORKSPACE.DASHBOARD.HERO_FAVORITE';
            case 'added':
                return 'WORKSPACE.DASHBOARD.HERO_RECENTLY_ADDED';
            case 'recent':
                return 'WORKSPACE.DASHBOARD.RECENTLY_WATCHED';
        }
    }

    /**
     * Resume slides keep the hero's resume handoff (a saved series episode
     * auto-plays) and offer "Details" as the detail-only way in; discovery
     * and fallback slides open the detail page; live slides open the channel.
     */
    private actionsFor(
        source: DashboardHeroSource,
        position: PlaybackPositionData | null
    ): Pick<DashboardHeroSlide, 'primaryAction' | 'secondaryAction'> {
        switch (source.kind) {
            case 'live':
                return {
                    primaryAction:
                        source.origin === 'favorite'
                            ? watchLiveAction(
                                  this.data.getGlobalFavoriteLink(source.item),
                                  this.data.getGlobalFavoriteNavigationState(
                                      source.item
                                  )
                              )
                            : watchLiveAction(
                                  this.data.getRecentItemLink(source.item),
                                  this.data.getRecentItemNavigationState(
                                      source.item
                                  )
                              ),
                    secondaryAction: null,
                };
            case 'favorite':
                return {
                    primaryAction: detailsAction(
                        this.data.getGlobalFavoriteLink(source.item),
                        this.data.getGlobalFavoriteNavigationState(source.item)
                    ),
                    secondaryAction: null,
                };
            case 'added':
                return {
                    primaryAction: detailsAction(
                        this.data.getRecentlyAddedLink(source.item),
                        this.data.getRecentlyAddedNavigationState(source.item)
                    ),
                    secondaryAction: null,
                };
            case 'continue':
            case 'recent': {
                const item = source.item;
                const link = this.data.getRecentItemLink(item);
                const state = this.data.getRecentItemNavigationState(item);
                if (item.type === 'live') {
                    return {
                        primaryAction: watchLiveAction(link, state),
                        secondaryAction: null,
                    };
                }
                // The fallback row can be a finished title (the resume
                // candidates skip those): nothing to continue, open details.
                if (source.kind === 'recent') {
                    return {
                        primaryAction: detailsAction(
                            link,
                            this.data.getRecentItemDetailNavigationState(item)
                        ),
                        secondaryAction: null,
                    };
                }
                const canResume =
                    this.data.getRecentItemResumeNavigation(item) !== null;
                return {
                    primaryAction: {
                        labelKey: 'WORKSPACE.DASHBOARD.HERO_CONTINUE',
                        icon: 'play_arrow',
                        link,
                        state,
                        remainingLabel: formatRemainingLabel(position),
                        testId: 'dashboard-hero-primary-action',
                    },
                    secondaryAction: canResume
                        ? {
                              ...detailsAction(
                                  link,
                                  this.data.getRecentItemDetailNavigationState(
                                      item
                                  )
                              ),
                              testId: 'dashboard-hero-secondary-action',
                          }
                        : null,
                };
            }
        }
    }
}

function watchLiveAction(
    link: string[],
    state: Record<string, unknown> | undefined
): DashboardHeroAction {
    return {
        labelKey: 'WORKSPACE.DASHBOARD.HERO_WATCH_LIVE',
        icon: 'play_arrow',
        link,
        state,
        testId: 'dashboard-hero-primary-action',
    };
}

function detailsAction(
    link: string[],
    state: Record<string, unknown> | undefined
): DashboardHeroAction {
    return {
        labelKey: 'WORKSPACE.DASHBOARD.HERO_DETAILS',
        icon: 'info',
        link,
        state,
        testId: 'dashboard-hero-primary-action',
    };
}
