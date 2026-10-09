import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { resolveEpisodeInfo } from './season-watch-toggle.util';

/**
 * How the selected season's episodes render:
 * - `loading`: metadata is still on its way — skeleton rows at final height;
 * - `full`: rows with thumbnails and plots (a missing still falls back to
 *   a dimmed tile, a missing plot leaves its line out);
 * - `bare`: no episode has a plot or a usable still — 44px text rows.
 */
export type EpisodeMetaState = 'loading' | 'full' | 'bare';

export interface EpisodeStillContext {
    /**
     * False when every episode of the season repeats one image: providers
     * often send the series poster as each episode's picture.
     */
    readonly distinctStills: boolean;
    /** Series poster and season cover: a "still" equal to either is none. */
    readonly posterUrls: readonly (string | null | undefined)[];
}

/** The episode's own still, or null when it has none worth showing. */
export function usableStillUrl(
    episode: XtreamSerieEpisode,
    context: EpisodeStillContext
): string | null {
    const image = resolveEpisodeInfo(episode)?.movie_image?.trim();
    if (!image || !context.distinctStills) {
        return null;
    }
    return context.posterUrls.some((poster) => poster?.trim() === image)
        ? null
        : image;
}

function hasPlot(episode: XtreamSerieEpisode): boolean {
    return !!resolveEpisodeInfo(episode)?.plot?.trim();
}

export interface EpisodeLoadingState {
    /** The provider's season or episode list is still on its way. */
    readonly list: boolean;
    /** A TMDB lookup that could still fill the episodes is outstanding. */
    readonly metadata: boolean;
}

/**
 * Decided from the data, never from timing alone: `loading` while the
 * provider list is outstanding; once it is in, `bare` only when no episode
 * has a plot and none has a usable still — and `loading` instead of `bare`
 * while metadata that could still fill those rows is outstanding. A season
 * the provider already describes renders at once; the metadata then lands
 * in place.
 */
export function resolveEpisodeMetaState(
    episodes: readonly XtreamSerieEpisode[],
    loading: EpisodeLoadingState,
    context: EpisodeStillContext
): EpisodeMetaState {
    if (loading.list) {
        return 'loading';
    }
    if (episodes.length === 0) {
        return 'full';
    }
    const bare = episodes.every(
        (episode) => !hasPlot(episode) && !usableStillUrl(episode, context)
    );
    if (!bare) {
        return 'full';
    }
    return loading.metadata ? 'loading' : 'bare';
}
