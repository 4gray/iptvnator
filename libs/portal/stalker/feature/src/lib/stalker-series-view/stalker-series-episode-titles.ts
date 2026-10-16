import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';

/**
 * Portals often send episodes without a name. Data access leaves those titles
 * empty because it cannot translate, TMDB fills the ones it knows, and the
 * rest get the label for "Episode N" here. Run it after the TMDB overlay: the
 * overlay only replaces empty or generic English titles, so a translated
 * label would keep the real TMDB name out.
 */
export function withEpisodeTitleFallback(
    seasons: Record<string, XtreamSerieEpisode[]>,
    episodeLabel: (episodeNumber: number) => string
): Record<string, XtreamSerieEpisode[]> {
    const labelled: Record<string, XtreamSerieEpisode[]> = {};
    for (const [seasonKey, episodes] of Object.entries(seasons)) {
        labelled[seasonKey] = episodes.map((episode) =>
            episode.title?.trim()
                ? episode
                : {
                      ...episode,
                      title: episodeLabel(Number(episode.episode_num)),
                  }
        );
    }
    return labelled;
}
