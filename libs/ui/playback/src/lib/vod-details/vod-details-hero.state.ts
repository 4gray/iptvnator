import { computed, type Signal } from '@angular/core';
import type { TranslateService } from '@ngx-translate/core';
import {
    formatDurationLabel,
    playbackProgressPercent,
} from '@iptvnator/portal/shared/util';
import type { CrossPortalSimilarItem } from '@iptvnator/services';
import {
    VideoPlayer,
    type ExternalPlayerName,
    type NormalizedVodMeta,
} from '@iptvnator/shared/interfaces';
import type { DetailActionButtonState } from '@iptvnator/ui/components';
import {
    buildCastMembers,
    buildCountryChips,
    buildDirectorMembers,
    buildGenreChips,
    buildPrimaryAction,
    buildSimilarRailItems,
    buildVodMenuSections,
    labelOf,
    vodDurationSeconds,
    formatPlaybackClock,
} from './vod-details-presentation';

export interface VodDetailsHeroStateDeps {
    readonly meta: Signal<NormalizedVodMeta>;
    readonly sourceLabel: Signal<string | null>;
    readonly playbackPosition: Signal<number | null>;
    readonly playbackDurationSeconds: Signal<number | null>;
    readonly hasPlaybackPosition: Signal<boolean>;
    readonly isWatched: Signal<boolean>;
    /** Managed MPV/VLC launches: the bridge serves openInMpv/openInVlc. */
    readonly supportsExternalPlayers: () => boolean;
    /** Play/Resume clicked, stream still resolving (Stalker `create_link`). */
    readonly playbackStartPending: Signal<boolean>;
    readonly isOfflinePrimary: Signal<boolean>;
    readonly externalLabel: Signal<string | null>;
    readonly externalIcon: Signal<string>;
    readonly externalState: Signal<DetailActionButtonState>;
    readonly similarInPortals: Signal<readonly CrossPortalSimilarItem[]>;
    readonly configuredPlayer: Signal<VideoPlayer | null | undefined>;
    readonly translate: Pick<TranslateService, 'instant'>;
}

/**
 * Everything the shared VOD hero shows, derived from the host's inputs:
 * the kind label, chips, primary button lines, resume bar, credits, the
 * Similar rail and the rows of the "…" menu.
 */
export function createVodDetailsHeroState(deps: VodDetailsHeroStateDeps) {
    const translate = (key: string, params?: Record<string, unknown>) =>
        deps.translate.instant(key, params);
    const kindLabel = computed(() => {
        const kind = translate('WORKSPACE.DASHBOARD.TYPE_MOVIE');
        const source = deps.sourceLabel()?.trim();
        return source ? `${kind} · ${source}` : kind;
    });
    const durationSeconds = computed(() =>
        vodDurationSeconds(deps.meta(), deps.playbackDurationSeconds())
    );
    const durationLabel = computed(() =>
        labelOf(formatDurationLabel(durationSeconds()), translate)
    );
    const castMembers = computed(() => buildCastMembers(deps.meta()));
    const directorMembers = computed(() => buildDirectorMembers(deps.meta()));
    const externalPlayer = computed<ExternalPlayerName>(() =>
        deps.configuredPlayer() === VideoPlayer.VLC ? 'vlc' : 'mpv'
    );

    return {
        kindLabel,
        durationSeconds,
        durationLabel,
        genreChips: computed(() => buildGenreChips(deps.meta())),
        countryChips: computed(() => buildCountryChips(deps.meta())),
        castMembers,
        directorMembers,
        castNames: computed(() => castMembers().map((member) => member.name)),
        directorNames: computed(() =>
            directorMembers().map((member) => member.name)
        ),
        progress: computed(() =>
            deps.hasPlaybackPosition()
                ? playbackProgressPercent({
                      positionSeconds: deps.playbackPosition() ?? 0,
                      durationSeconds: durationSeconds() || undefined,
                  })
                : null
        ),
        primaryAction: computed(() =>
            buildPrimaryAction(
                {
                    externalLabel: deps.externalLabel(),
                    externalIcon: deps.externalIcon(),
                    externalState: deps.externalState(),
                    isOfflinePrimary: deps.isOfflinePrimary(),
                    hasPlaybackPosition: deps.hasPlaybackPosition(),
                    positionSeconds: deps.playbackPosition(),
                    durationSeconds: durationSeconds(),
                    formattedPosition: formatPlaybackClock(
                        deps.playbackPosition()
                    ),
                },
                translate
            )
        ),
        similarRailItems: computed(() =>
            buildSimilarRailItems(deps.similarInPortals())
        ),
        externalPlayer,
        menuSections: computed(() =>
            buildVodMenuSections({
                // Provider-only mode hides local/download controls, not the
                // provider's own stream in MPV/VLC.
                externalPlayerAvailable: deps.supportsExternalPlayers(),
                externalPlayerHint: externalPlayer() === 'vlc' ? 'VLC' : 'MPV',
                hasPlaybackPosition: deps.hasPlaybackPosition(),
                hasStoredProgress:
                    (deps.playbackPosition() ?? 0) > 0 || deps.isWatched(),
                // Inline playback collapses the hero; an external player, or
                // a start still resolving its stream, can still own the row
                // while the menu is reachable.
                playbackActive:
                    deps.externalState() !== 'idle' ||
                    deps.playbackStartPending(),
                startPending: deps.playbackStartPending(),
            })
        ),
    };
}
