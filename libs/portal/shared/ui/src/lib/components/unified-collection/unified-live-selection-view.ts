import { computed, inject, Signal } from '@angular/core';
import { isDashChannel, isDashStreamUrl } from '@iptvnator/shared/m3u-utils';
import { ResolvedLiveCollectionDetail } from '@iptvnator/portal/shared/data-access';
import {
    getLiveCollectionPlaylistNavigation,
    PORTAL_PLAYER,
    UnifiedCollectionItem,
    WorkspaceNavigationTarget,
} from '@iptvnator/portal/shared/util';
import { SettingsStore } from '@iptvnator/services';
import {
    Channel,
    EpgItem,
    EpgProgram,
    playlistDisplayLabel,
    ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { createUnifiedLivePlaybackSessionKey } from './unified-live-playback-session-key';
import { UnifiedLiveTimeshift } from './unified-live-catchup';

/**
 * Everything the live tab derives from "what is selected right now": the
 * source shape behind it, and which player surface it belongs on.
 */
export interface UnifiedLiveSelectionView {
    readonly player: Signal<VideoPlayer>;
    readonly isEmbeddedPlayer: Signal<boolean>;
    /** Playback target for the inline player, honouring a catch-up override. */
    readonly inlinePlayback: Signal<ResolvedPortalPlayback | null>;
    readonly currentStreamUrl: Signal<string>;
    readonly isM3uSelection: Signal<boolean>;
    readonly currentPortalEpgItems: Signal<EpgItem[]>;
    readonly currentM3uPrograms: Signal<EpgProgram[]>;
    readonly currentM3uChannel: Signal<Channel | null>;
    readonly activeRadioChannel: Signal<Channel | null>;
    readonly isRadioSelection: Signal<boolean>;
    readonly isM3uDashSelection: Signal<boolean>;
    /** Player the inline surface uses, after the DASH correction. */
    readonly inlinePlayer: Signal<VideoPlayer>;
    readonly shouldUseInlinePlayer: Signal<boolean>;
    /** Identity of the selection an EPG archive action would act on. */
    readonly archiveContextKey: Signal<string>;
    /**
     * "Open in playlist" for the channel on screen: the EPG panel chip
     * renders only while this resolves (Xtream/M3U; Stalker has no
     * open-on-arrival contract yet). Same verdict the row menu uses.
     */
    readonly openInPlaylistTarget: Signal<WorkspaceNavigationTarget | null>;
    readonly openInPlaylistName: Signal<string>;
    readonly playbackSessionKey: Signal<string>;
    isRadioDetail(
        detail: ResolvedLiveCollectionDetail | null | undefined
    ): boolean;
    /** Whether activating this detail should launch the external player. */
    shouldOpenExternalPlayback(
        detail: ResolvedLiveCollectionDetail,
        startPlayback?: boolean
    ): boolean;
}

/**
 * Must run in an injection context (the hosting component's field
 * initializer or constructor).
 */
export function createUnifiedLiveSelectionView(options: {
    activeItem: Signal<UnifiedCollectionItem | null>;
    activeDetail: Signal<ResolvedLiveCollectionDetail | null>;
    activeTimeshift: Signal<UnifiedLiveTimeshift | null>;
}): UnifiedLiveSelectionView {
    const settingsStore = inject(SettingsStore);
    const portalPlayer = inject(PORTAL_PLAYER);

    const player = settingsStore.player;
    const isEmbeddedPlayer = computed(() => portalPlayer.isEmbeddedPlayer());

    const inlinePlayback = computed(() => {
        const playback = options.activeDetail()?.playback ?? null;
        const timeshift = options.activeTimeshift();
        if (!playback || !timeshift) {
            return playback;
        }

        return {
            ...playback,
            streamUrl: timeshift.url,
            isLive: false,
        };
    });

    const isM3uSelection = computed(
        () => options.activeDetail()?.epgMode === 'm3u'
    );

    const currentM3uChannel = computed(() => {
        const detail = options.activeDetail();
        return detail?.epgMode === 'm3u' ? (detail.channel ?? null) : null;
    });

    const currentStreamUrl = computed(() => inlinePlayback()?.streamUrl ?? '');

    const activeRadioChannel = computed(() => {
        const channel = options.activeDetail()?.channel ?? null;
        return channel?.radio === 'true' ? channel : null;
    });
    const isRadioSelection = computed(() => activeRadioChannel() !== null);

    // Match the M3U player: DASH needs Shaka even with Video.js or MPV/VLC
    // selected.
    const isM3uDashSelection = computed(
        () =>
            isM3uSelection() &&
            (isDashStreamUrl(currentStreamUrl()) ||
                isDashChannel(currentM3uChannel()))
    );

    const isRadioDetail = (
        detail: ResolvedLiveCollectionDetail | null | undefined
    ): boolean => detail?.channel?.radio === 'true';

    return {
        player,
        isEmbeddedPlayer,
        inlinePlayback,
        currentStreamUrl,
        isM3uSelection,
        currentPortalEpgItems: computed(
            () => options.activeDetail()?.epgItems ?? []
        ),
        currentM3uPrograms: computed(() => {
            const detail = options.activeDetail();
            if (detail?.epgMode !== 'm3u' || detail.channel?.radio === 'true') {
                return [];
            }

            return detail.epgPrograms ?? [];
        }),
        currentM3uChannel,
        activeRadioChannel,
        isRadioSelection,
        isM3uDashSelection,
        archiveContextKey: computed(() =>
            JSON.stringify([
                options.activeItem()?.uid,
                options.activeItem()?.playlistId,
                currentM3uChannel()?.url,
            ])
        ),
        openInPlaylistTarget: computed(() => {
            const item = options.activeItem();
            return item ? getLiveCollectionPlaylistNavigation(item) : null;
        }),
        openInPlaylistName: computed(() =>
            playlistDisplayLabel(options.activeItem()?.playlistName)
        ),
        playbackSessionKey: computed(() =>
            createUnifiedLivePlaybackSessionKey(options.activeItem())
        ),
        inlinePlayer: computed(() =>
            isM3uDashSelection() && player() !== VideoPlayer.ArtPlayer
                ? VideoPlayer.Html5Player
                : player()
        ),
        shouldUseInlinePlayer: computed(
            () =>
                isRadioSelection() || isM3uDashSelection() || isEmbeddedPlayer()
        ),
        isRadioDetail,
        shouldOpenExternalPlayback(
            detail: ResolvedLiveCollectionDetail,
            startPlayback = false
        ): boolean {
            if (
                isRadioDetail(detail) ||
                isM3uDashSelection() ||
                portalPlayer.isEmbeddedPlayer()
            ) {
                return false;
            }

            return !settingsStore.openStreamOnDoubleClick() || startPlayback;
        },
    };
}
