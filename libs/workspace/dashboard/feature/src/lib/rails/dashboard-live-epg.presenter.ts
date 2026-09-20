import {
    computed,
    inject,
    Injectable,
    signal,
    type Signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
    catchError,
    defaultIfEmpty,
    forkJoin,
    interval,
    map,
    of,
    startWith,
    switchMap,
} from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';
import { DashboardDataService } from '@iptvnator/workspace/dashboard/data-access';
import type { DashboardRailCard } from './dashboard-rail.component';
import {
    buildDashboardLiveEpgDetails,
    buildLiveEpgLookupGroups,
    getLiveEpgProgramForCard,
    liveEpgAllowsAnySource,
    liveEpgProgramKey,
    liveEpgScopeKey,
    LIVE_EPG_TICK_MS,
    type DashboardLiveEpgDetails,
    type DashboardLiveEpgLookupGroup,
} from './dashboard-live-epg.utils';

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
 */
@Injectable()
export class DashboardLiveEpgPresenter {
    private readonly data = inject(DashboardDataService);
    private readonly epgService = inject(EpgService);
    private readonly settingsStore = inject(SettingsStore);

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

    private readonly lookupGroups = computed(() =>
        buildLiveEpgLookupGroups(this.cards()?.() ?? [], (card) =>
            this.sourceUrlsForCard(card)
        )
    );

    // Re-fetch on rail change AND on a 30s heartbeat so the progress bar
    // catches the boundary between programs without a full page revisit.
    private readonly programs = toSignal(
        toObservable(this.lookupGroups).pipe(
            switchMap((groups) =>
                groups.length === 0
                    ? of(new Map<string, EpgProgram | null>())
                    : interval(LIVE_EPG_TICK_MS).pipe(
                          startWith(0),
                          switchMap(() =>
                              forkJoin(
                                  groups.map((group) => this.askScope(group))
                              ).pipe(map((answers) => mergeAnswers(answers)))
                          )
                      )
            )
        ),
        { initialValue: new Map<string, EpgProgram | null>() }
    );

    /** The live cards whose rails are enabled, hero included. */
    connect(cards: Signal<readonly DashboardRailCard[]>): void {
        this.cards.set(cards);
    }

    /** `null` when nothing is known about the card's current programme. */
    detailsFor(card: DashboardRailCard | null): DashboardLiveEpgDetails | null {
        if (!card) {
            return null;
        }
        const program = getLiveEpgProgramForCard(
            card,
            this.programs(),
            liveEpgScopeKey(
                this.sourceUrlsForCard(card),
                liveEpgAllowsAnySource(card)
            )
        );
        // Recompute the now-window each tick so progress moves between
        // 30s ticks even if the program identity is unchanged.
        return buildDashboardLiveEpgDetails(
            program,
            Date.now(),
            this.settingsStore.resolvedEpgOffsetMinutes()
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
