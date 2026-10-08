import type { TranslateService } from '@ngx-translate/core';
import {
    formatDurationLabel,
    formatRemainingLabel,
    isPortalPlaybackWatched,
} from '@iptvnator/portal/shared/util';
import {
    PlaybackPositionData,
    XtreamSerieEpisodeInfo,
} from '@iptvnator/shared/interfaces';
import {
    episodeRuntimeSeconds,
    formatEpisodePositionText,
} from './episode-progress.util';

/**
 * The line under an episode card's title, built from the episode's runtime
 * and its saved playback position:
 * "42 min · 18m left", "42 min · watched", "42 min" — or null.
 */
export function buildEpisodeSubline(
    info: XtreamSerieEpisodeInfo | undefined,
    position: PlaybackPositionData | undefined,
    translate: Pick<TranslateService, 'instant'>
): string | null {
    const duration = formatDurationLabel(episodeRuntimeSeconds(info));
    const remaining = formatRemainingLabel(position);
    const parts = [
        duration ? translate.instant(duration.key, duration.params) : null,
        isPortalPlaybackWatched(position)
            ? translate.instant('PORTALS.DETAIL.WATCHED')
            : remaining
              ? translate.instant(remaining.key, remaining.params)
              : formatEpisodePositionText(position),
    ].filter((part): part is string => !!part);
    return parts.length ? parts.join(' · ') : null;
}
