import { computed, type Signal, signal, type TemplateRef } from '@angular/core';
import type {
    PlaybackPositionData,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type {
    FullscreenChannelPanelContext,
    FullscreenChannelPanelHost,
} from '../fullscreen-channel-panel/fullscreen-channel-panel.model';
import {
    buildFullscreenEpisodePanelSeasons,
    type FullscreenEpisodePanelSeason,
    type FullscreenPanelEpisodeLike,
    type FullscreenPanelSeasonLoadState,
} from '../fullscreen-episode-panel/fullscreen-episode-panel.util';

export type SeasonLoadStates = Readonly<
    Record<string, Exclude<FullscreenPanelSeasonLoadState, 'loaded'>>
>;

export interface EpisodePanelHostInputs {
    /** The `#fullscreenEpisodePanel` template of the inline player. */
    template: Signal<TemplateRef<FullscreenChannelPanelContext> | undefined>;
    /** `Settings.fullscreenChannelPanel`, the one toggle for both lists. */
    panelEnabled: () => boolean;
    playback: Signal<ResolvedPortalPlayback | null>;
    seriesEpisodes: Signal<Record<
        string,
        readonly FullscreenPanelEpisodeLike[]
    > | null>;
    playbackPositions: Signal<ReadonlyMap<number, PlaybackPositionData> | null>;
    seasonLoadStates: Signal<SeasonLoadStates | null>;
    seriesTitle: Signal<string | null>;
    /** Playback title, the header fallback when the host names no series. */
    fallbackTitle: Signal<string>;
}

export interface PortalInlinePlayerEpisodePanelHost extends FullscreenChannelPanelHost {
    /** Seasons handed to `app-fullscreen-episode-panel`. */
    readonly seasons: Signal<FullscreenEpisodePanelSeason[]>;
    /** The playing episode's id, or null while no episode plays inline. */
    readonly playingEpisodeId: Signal<number | null>;
}

/**
 * The `FULLSCREEN_CHANNEL_PANEL` host the inline player provides for its
 * nested `app-web-player-view` during series playback: the episode list
 * with season tabs, no search field. Kept out of the component so the
 * player's own responsibilities stay readable; the component only wires
 * its inputs in and stamps the panel body.
 *
 * `panelTemplate` is null — every affordance disappears — while no episode
 * plays inline (a movie never gets the panel), while the host supplied no
 * seasons, or when the user opted out of the fullscreen panel. Native-view
 * Embedded MPV and the external players are excluded upstream: the view
 * withholds the panel for the former, and the latter never mount the inline
 * player at all.
 */
export function createEpisodePanelHost(
    inputs: EpisodePanelHostInputs
): PortalInlinePlayerEpisodePanelHost {
    const playingEpisodeId = computed<number | null>(() => {
        const playback = inputs.playback();
        const info = playback?.contentInfo;
        return info?.contentType === 'episode' && !playback?.isLive
            ? info.contentXtreamId
            : null;
    });
    const seasons = computed(() =>
        buildFullscreenEpisodePanelSeasons({
            episodesBySeason: inputs.seriesEpisodes(),
            currentEpisodeId: playingEpisodeId(),
            playbackPositions: inputs.playbackPositions(),
            seasonLoadStates: inputs.seasonLoadStates(),
        })
    );

    return {
        seasons,
        playingEpisodeId,
        panelTemplate: computed(() =>
            !inputs.panelEnabled() ||
            playingEpisodeId() === null ||
            seasons().length === 0
                ? null
                : (inputs.template() ?? null)
        ),
        panelTitle: computed(
            () => inputs.seriesTitle()?.trim() || inputs.fallbackTitle()
        ),
        // Season tabs are the panel's navigation; no search field.
        panelSearchEnabled: signal(false).asReadonly(),
        panelKind: 'episodes',
    };
}
