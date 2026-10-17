import { Signal, computed, effect, inject, signal } from '@angular/core';
import { IntroDbService, type IntroDbEpisodeLookup } from '@iptvnator/services';
import {
    type IntroDbEpisodeSegments,
    type ResolvedPortalPlayback,
    resolveEnrichmentSeasonNumber,
} from '@iptvnator/shared/interfaces';
import type { PlayerSkipSegment } from '../player-controls';
import type { SeriesEpisodeMetadata } from './series-playback-navigation';

export interface SkipSegmentsDeps {
    playback: Signal<ResolvedPortalPlayback | null>;
    episodeMetadata: Signal<SeriesEpisodeMetadata | null>;
    seriesTitle: Signal<string | null>;
    seriesTmdbId: Signal<number | null>;
    /** Number of seasons the provider lists for this series. */
    seasonCount: Signal<number>;
    /** `playerSkipIntro`: off means no IntroDB / TVmaze request at all. */
    enabled: Signal<boolean>;
    /** `playerAutoSkipIntro`: the controls skip the segments on entry. */
    autoSkip: Signal<boolean>;
}

/** The skippable segments in playback order; the outro is the Up next card's. */
export function toPlayerSkipSegments(
    segments: IntroDbEpisodeSegments | null
): PlayerSkipSegment[] | null {
    const result: PlayerSkipSegment[] = [];
    if (segments?.recap) {
        result.push({ kind: 'recap', ...segments.recap });
    }
    if (segments?.intro) {
        result.push({ kind: 'intro', ...segments.intro });
    }
    result.sort((a, b) => a.startSeconds - b.startSeconds);
    return result.length ? result : null;
}

function sameLookup(
    a: IntroDbEpisodeLookup | null,
    b: IntroDbEpisodeLookup | null
): boolean {
    return (
        a === b ||
        (!!a &&
            !!b &&
            a.tmdbId === b.tmdbId &&
            a.seriesTitle === b.seriesTitle &&
            a.seasonNumber === b.seasonNumber &&
            a.episodeNumber === b.episodeNumber)
    );
}

/**
 * The playing episode's IntroDB intro / recap, for the controls' "Skip
 * intro" button; null for movies, live playback, episodes IntroDB does not
 * know, and whenever the viewer turned the button off. A per-season provider slice ("The Boys S05" listing one season
 * as season 1) is renumbered from its title marker, as TMDB enrichment
 * does, because IntroDB numbers seasons like TMDB and IMDb.
 *
 * Must run in an injection context (a component field initializer).
 */
export function createSkipSegments(
    deps: SkipSegmentsDeps
): Signal<readonly PlayerSkipSegment[] | null> {
    const introDb = inject(IntroDbService);
    const lookup = computed<IntroDbEpisodeLookup | null>(
        () => {
            const playback = deps.playback();
            const metadata = deps.episodeMetadata();
            if (
                !deps.enabled() ||
                !metadata ||
                !playback ||
                playback.isLive ||
                playback.contentInfo?.contentType !== 'episode'
            ) {
                return null;
            }
            const seriesTitle = deps.seriesTitle()?.trim() || null;
            return {
                tmdbId: deps.seriesTmdbId(),
                seriesTitle,
                seasonNumber: resolveEnrichmentSeasonNumber({
                    rawTitle: seriesTitle ?? '',
                    providerSeasonNumber: metadata.seasonNumber,
                    providerSeasonCount: deps.seasonCount(),
                }),
                episodeNumber: metadata.episodeNumber,
            };
        },
        { equal: sameLookup }
    );
    const segments = signal<readonly PlayerSkipSegment[] | null>(null);

    effect((onCleanup) => {
        const request = lookup();
        // Never show the previous episode's intro on the next one.
        segments.set(null);
        if (!request || !introDb.isAvailable) {
            return;
        }
        let current = true;
        onCleanup(() => (current = false));
        void introDb.getEpisodeSegments(request).then((result) => {
            if (current) {
                segments.set(toPlayerSkipSegments(result));
            }
        });
    });

    // The preference is applied here, not in the lookup, so switching it
    // never asks IntroDB again.
    return computed(() => {
        const found = segments();
        const autoSkip = deps.autoSkip();
        return found && autoSkip
            ? found.map((segment) => ({ ...segment, autoSkip }))
            : found;
    });
}
