import {
    computed,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
    catchError,
    combineLatest,
    defaultIfEmpty,
    distinctUntilChanged,
    filter,
    forkJoin,
    map,
    merge,
    of,
    skip,
    switchMap,
    tap,
} from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import {
    epgProviderClockMs,
    normalizeDashboardRailsSettings,
    type EpgProgram,
    type PortalActivityItem,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';
import {
    buildDashboardPortalLiveEpgKey,
    DashboardDataService,
} from '@iptvnator/workspace/dashboard/data-access';
import type { DashboardRailCard } from './dashboard-rail.component';
import { DashboardLiveEpgClock } from './dashboard-live-epg-clock';
import { DashboardPortalLiveEpgPresenter } from './dashboard-portal-live-epg.presenter';
import {
    buildDashboardLiveEpgDetails,
    buildLiveEpgLookupGroups,
    getLiveEpgProgramForCard,
    liveEpgAllowsAnySource,
    liveEpgAnswersNeedRefresh,
    liveEpgProgramKey,
    liveEpgScopeKey,
    LIVE_EPG_MAX_ANSWER_AGE_MS,
    sameLiveEpgAnswers,
    type DashboardLiveEpgDetails,
    type DashboardLiveEpgLookupGroup,
} from './dashboard-live-epg.utils';
import { RAIL_ITEM_LIMIT } from './dashboard-rail.utils';
import {
    selectDashboardHeroLiveCandidates,
    type DashboardHeroLiveCandidate,
} from './dashboard-hero-slides.utils';

type ScopeAnswer = {
    readonly scopeKey: string;
    readonly programs: ReadonlyMap<string, EpgProgram | null>;
};

const emptyAnswer = (scopeKey: string): ScopeAnswer => ({
    scopeKey,
    programs: new Map<string, EpgProgram | null>(),
});

/**
 * The dashboard's uploaded-XMLTV "now on air" lookup for live cards.
 * Component-provided, so the 30 s heartbeat dies with the page.
 *
 * Best-effort, keyed by the app-wide M3U chain (tvg-id -> tvg-name -> name)
 * with the card title as a final fallback. Xtream/Stalker live items often
 * have no XMLTV side-channel and simply return null — the card then renders
 * without the programme row.
 *
 * One lookup per source scope, not one for the whole page: a `tvg-id` is
 * unique inside a guide, not across imports, so a card is only ever handed
 * the answer resolved in ITS playlist's scope. Each lookup then opts into the
 * any-source retry — Settings global sources first, then every imported
 * XMLTV, which is what the "See all" collection pages resolve against.
 * Without it a channel whose guide only exists in another playlist's XMLTV
 * showed no programme here while its "See all" row had one.
 *
 * It is also the one facade the rails talk to for live EPG: an Xtream or
 * Stalker card has no XMLTV key of its own, so its programme comes from
 * `DashboardPortalLiveEpgPresenter` and only falls back to the title match
 * here.
 */
@Injectable()
export class DashboardLiveEpgPresenter {
    private readonly data = inject(DashboardDataService);
    private readonly epgService = inject(EpgService);
    private readonly settingsStore = inject(SettingsStore);
    /** Xtream/Stalker cards are answered by their portal, not by XMLTV. */
    private readonly portal = inject(DashboardPortalLiveEpgPresenter);
    private readonly clock = inject(DashboardLiveEpgClock);

    private readonly cards = signal<Signal<
        readonly DashboardRailCard[]
    > | null>(null);

    // The XMLTV sources each playlist declares. Same rule as
    // `ChannelListContainerComponent`: only an M3U playlist carries its own
    // guide; a portal playlist is answered from the Settings-managed URLs.
    private readonly sourceUrlsByPlaylist = computed(() => {
        const byPlaylistId = new Map<string, string[]>();
        for (const playlist of this.data.playlists()) {
            byPlaylistId.set(
                playlist._id,
                playlist.serverUrl || playlist.macAddress
                    ? []
                    : normalizeEpgUrls(playlist.epgUrls ?? [])
            );
        }
        return byPlaylistId;
    });

    private readonly rails = computed(() =>
        normalizeDashboardRailsSettings(this.settingsStore.dashboardRails?.())
    );

    /**
     * Channels that may fill the hero's live slide. Looked up and pinned
     * here, independent of the rails, so the slide works with the live rails
     * hidden and never waits for a rail to scroll a card into view.
     */
    readonly heroLiveCandidates = computed<DashboardHeroLiveCandidate[]>(() =>
        this.rails().hero
            ? selectDashboardHeroLiveCandidates(
                  this.data.globalFavoriteLiveItems(),
                  this.data.globalRecentLiveItems()
              )
            : []
    );

    private readonly heroLiveCards = computed(() =>
        this.heroLiveCandidates().map(({ item }) =>
            buildDashboardLiveEpgCard(item)
        )
    );

    private readonly lookupGroups = computed(() =>
        buildLiveEpgLookupGroups(
            [...this.heroLiveCards(), ...(this.cards()?.() ?? [])],
            (card) => this.sourceUrlsForCard(card)
        )
    );

    /** The lookup groups the XMLTV batch below last answered. */
    private readonly answeredLookupGroups = signal<
        readonly DashboardLiveEpgLookupGroup[] | null
    >(null);

    private readonly offsetMinutes = computed(() =>
        this.settingsStore.resolvedEpgOffsetMinutes()
    );
    /** Created once: `toObservable` owns an effect for the injector's life. */
    private readonly now$ = toObservable(this.clock.now);

    /** A guide import or source change can replace a programme on air. */
    private readonly guideChanged$ = this.epgService.epgAvailable$.pipe(
        skip(1),
        filter(Boolean),
        map(() => Date.now())
    );

    // Asked on rail or offset change and whenever the guide changes. On
    // clock ticks it is asked again only once an answer can be stale: a
    // programme ended, a key is still without one, or the answer is older
    // than LIVE_EPG_MAX_ANSWER_AGE_MS. An unchanged answer is not
    // re-emitted, so the rails rebuild on a tick only for the progress bars.
    private readonly programs = toSignal(
        combineLatest([
            toObservable(this.lookupGroups),
            toObservable(this.offsetMinutes),
        ]).pipe(
            switchMap(([groups, offsetMinutes]) => {
                if (groups.length === 0) {
                    this.answeredLookupGroups.set(groups);
                    return of(new Map<string, EpgProgram | null>());
                }
                let answers: ReadonlyMap<string, EpgProgram | null> | null =
                    null;
                let answeredAt = 0;
                return merge(
                    this.now$,
                    this.guideChanged$.pipe(tap(() => (answers = null)))
                ).pipe(
                    filter(
                        (nowMs) =>
                            nowMs - answeredAt >= LIVE_EPG_MAX_ANSWER_AGE_MS ||
                            liveEpgAnswersNeedRefresh(
                                answers,
                                groups,
                                epgProviderClockMs(nowMs, offsetMinutes)
                            )
                    ),
                    switchMap(() =>
                        forkJoin(
                            groups.map((group) => this.askScope(group))
                        ).pipe(map((scopes) => mergeAnswers(scopes)))
                    ),
                    tap((merged) => {
                        answers = merged;
                        answeredAt = Date.now();
                        this.answeredLookupGroups.set(groups);
                    }),
                    distinctUntilChanged(sameLiveEpgAnswers)
                );
            })
        ),
        { initialValue: new Map<string, EpgProgram | null>() }
    );

    // The Xtream/Stalker live rows behind the hero and the two live rails.
    // Their programmes come from the portal, asked for lazily per visible
    // card; M3U rows stay on the XMLTV batch above.
    private readonly portalItems = computed<readonly PortalActivityItem[]>(
        () => {
            const rails = this.rails();
            return [
                ...this.heroLiveCandidates().map(({ item }) => item),
                ...(rails.liveFavorites
                    ? this.data
                          .globalFavoriteLiveItems()
                          .slice(0, RAIL_ITEM_LIMIT)
                    : []),
                ...(rails.recentlyWatchedLive
                    ? this.data
                          .globalRecentLiveItems()
                          .slice(0, RAIL_ITEM_LIMIT)
                    : []),
            ];
        }
    );

    constructor() {
        this.clock.demand(computed(() => this.lookupGroups().length > 0));
        this.portal.connect(this.portalItems);
        // The hero sits at the top of the page and is never scrolled into
        // view, so its candidates are wanted regardless of what the rails
        // report. Only those: a rail card nobody can see stays unpinned.
        effect(() => {
            const keys = this.heroLiveCandidates().map(({ item }) =>
                buildDashboardPortalLiveEpgKey(item)
            );
            untracked(() => this.portal.setPinnedKeys(keys));
        });
    }

    /** The live cards whose rails are enabled (hero candidates are added here). */
    connect(cards: Signal<readonly DashboardRailCard[]>): void {
        this.cards.set(cards);
    }

    /** A rail reported the cards inside its viewport. */
    setVisibleCards(railId: string, cards: readonly DashboardRailCard[]): void {
        this.portal.setVisibleCards(railId, cards);
    }

    /** The rails' cards with their "now on air" row filled in. */
    enrich(cards: readonly DashboardRailCard[]): DashboardRailCard[] {
        return cards.map((card) => {
            const details = this.detailsFor(card);
            // Placeholder only before the FIRST portal answer: a refresh
            // keeps the previous answer on screen instead of flashing.
            const pending = !details && this.isAwaitingFirstAnswer(card);
            if (!details && !pending) {
                return card;
            }
            return {
                ...card,
                ...(details ?? {}),
                nowPlayingState: pending ? 'pending' : null,
            };
        });
    }

    /**
     * True while a hero live candidate may still get its first programme:
     * its portal has not answered yet, or the XMLTV batch has not answered
     * the current lookups. A live slide exists only once a programme is on
     * air, so the hero keeps its skeleton meanwhile instead of inserting
     * the slide late.
     */
    readonly heroLiveAwaitingFirstAnswer = computed(() => {
        const cards = this.heroLiveCards();
        if (cards.length === 0) {
            return false;
        }
        return (
            this.answeredLookupGroups() !== this.lookupGroups() ||
            cards.some((card) =>
                this.portal.awaitsFirstAnswer(card.liveEpgSourceKey)
            )
        );
    });

    /** Current programme of a hero live candidate, or `null`. */
    heroDetailsFor(item: PortalActivityItem): DashboardLiveEpgDetails | null {
        return this.detailsFor(buildDashboardLiveEpgCard(item));
    }

    /** `null` when nothing is known about the card's current programme. */
    detailsFor(card: DashboardRailCard | null): DashboardLiveEpgDetails | null {
        if (!card) {
            return null;
        }
        // A portal answer wins. Its `null` ("asked, nothing on air") and
        // "not asked yet" both fall back to the XMLTV lookup, which for a
        // portal card can only ever be a title match.
        const program =
            this.portal.programFor(card.liveEpgSourceKey) ??
            getLiveEpgProgramForCard(
                card,
                this.programs(),
                liveEpgScopeKey(
                    this.sourceUrlsForCard(card),
                    liveEpgAllowsAnySource(card)
                )
            );
        // Read the clock so progress moves on every tick even while the
        // programme itself is unchanged.
        this.clock.now();
        return buildDashboardLiveEpgDetails(
            program,
            Date.now(),
            this.settingsStore.resolvedEpgOffsetMinutes()
        );
    }

    /**
     * True only before a card's FIRST portal answer, so a refresh keeps the
     * previous answer on screen instead of flashing a placeholder.
     */
    private isAwaitingFirstAnswer(card: DashboardRailCard): boolean {
        return (
            this.portal.programFor(card.liveEpgSourceKey) === undefined &&
            this.portal.isPending(card.liveEpgSourceKey)
        );
    }

    /** The XMLTV scope a live card's programme must be resolved in. */
    private sourceUrlsForCard(card: DashboardRailCard): string[] {
        const byPlaylistId = this.sourceUrlsByPlaylist();
        return (
            (card.epgPlaylistId
                ? byPlaylistId.get(card.epgPlaylistId)
                : undefined) ?? []
        );
    }

    private askScope(group: DashboardLiveEpgLookupGroup) {
        const scopeKey = group.scopeKey;
        return this.epgService
            .getCurrentProgramsForChannels(group.lookupKeys, {
                sourceUrls: group.sourceUrls,
                anySourceFallback: group.anySourceFallback,
            })
            .pipe(
                map((programs): ScopeAnswer => ({ scopeKey, programs })),
                // One scope retired by an EPG source change, or failing, must
                // not blank every other scope's answer for the tick:
                // `forkJoin` emits nothing at all when one input completes
                // without a value.
                defaultIfEmpty(emptyAnswer(scopeKey)),
                catchError(() => of(emptyAnswer(scopeKey)))
            );
    }
}

/** Namespaced by scope, so two guides sharing an id stay apart. */
function mergeAnswers(
    answers: readonly ScopeAnswer[]
): Map<string, EpgProgram | null> {
    const merged = new Map<string, EpgProgram | null>();
    for (const answer of answers) {
        for (const [lookupKey, program] of answer.programs) {
            merged.set(liveEpgProgramKey(answer.scopeKey, lookupKey), program);
        }
    }
    return merged;
}

/** The fields the EPG lookups read, for a live row that has no rail card. */
function buildDashboardLiveEpgCard(
    item: PortalActivityItem
): DashboardRailCard {
    return {
        id: `hero-live-${item.playlist_id}-${item.xtream_id ?? item.id}`,
        title: item.title,
        icon: 'live_tv',
        contentType: 'live',
        link: [],
        epgLookupKey: item.epg_lookup_key,
        epgPlaylistId: item.playlist_id,
        liveEpgSourceKey: buildDashboardPortalLiveEpgKey(item),
    };
}
