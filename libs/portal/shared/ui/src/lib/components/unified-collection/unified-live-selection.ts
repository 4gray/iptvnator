import { inject, WritableSignal } from '@angular/core';
import {
    ResolvedLiveCollectionDetail,
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import {
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { ElectronStreamHeadersService } from '@iptvnator/ui/playback';
import { UnifiedLiveTimeshift } from './unified-live-catchup';
import { UnifiedLiveSelectionGeneration } from './unified-live-selection-generation';

export interface UnifiedLiveSelection {
    /**
     * Activate a collection row. `startPlayback` forces the external player
     * in double-click-to-play mode; `isAutoOpen` reports back to the host
     * once the row is really on screen.
     */
    activate(
        item: UnifiedCollectionItem,
        isAutoOpen?: boolean,
        startPlayback?: boolean
    ): Promise<void>;
    /** Tear the selection down and release anything scoped to it. */
    close(): void;
    /** Release the radio header override; for the host's destroy hook. */
    dispose(): void;
}

/**
 * Resolving the selected live row into something playable, and keeping the
 * player that is already mounted alive while the next one resolves.
 *
 * `activeUid` is the pending selection (row highlight). `activeItem` stays
 * paired with `activeDetail`: the previous detail stays mounted while the
 * next one resolves, because the player it renders owns DOM fullscreen and a
 * selection from the fullscreen channel panel must not unmount that element
 * (which would end fullscreen) for the resolution round-trip — and
 * everything derived from the item (`playbackSessionKey`, recording/archive
 * metadata) must keep describing the stream that player is still showing.
 * The catch-up override belongs to that detail too: clearing it early would
 * drop the mounted player back to the old channel's live URL for the gap.
 * All of it swaps together when the new detail is in; a failed replacement
 * keeps a previously mounted video and restores its row.
 *
 * Must run in an injection context (the hosting component's field
 * initializer or constructor).
 */
export function createUnifiedLiveSelection(options: {
    activeUid: WritableSignal<string | null>;
    activeItem: WritableSignal<UnifiedCollectionItem | null>;
    activeDetail: WritableSignal<ResolvedLiveCollectionDetail | null>;
    activeTimeshift: WritableSignal<UnifiedLiveTimeshift | null>;
    isSelecting: WritableSignal<boolean>;
    generation: UnifiedLiveSelectionGeneration;
    supportsEpg: boolean;
    isRadioDetail(
        detail: ResolvedLiveCollectionDetail | null | undefined
    ): boolean;
    shouldOpenExternalPlayback(
        detail: ResolvedLiveCollectionDetail,
        startPlayback: boolean
    ): boolean;
    /** The row became the latest watched item; the host refreshes its list. */
    onItemPlayed(item: UnifiedCollectionItem): void;
    onAutoOpenHandled(): void;
}): UnifiedLiveSelection {
    const streamResolver = inject(StreamResolverService);
    const recentData = inject(UnifiedRecentDataService);
    const streamHeaders = inject(ElectronStreamHeadersService);
    const portalPlayer = inject(PORTAL_PLAYER);

    /** Stream URL of the radio playback whose header override this configured. */
    let radioHeaderScopeUrl: string | null = null;
    /**
     * The selection still resolving. `activeUid` alone cannot tell a pending
     * highlight from the stream on screen — `activeItem`/`activeDetail` stay
     * paired with the retained player until the replacement is in — so a
     * second activation of the same pending row (a double-click's second
     * click, an auto-open) folds its intent in here rather than restarting
     * the request or, worse, launching the retained stream in its place.
     */
    let pendingActivation: {
        readonly uid: string;
        startPlayback: boolean;
        isAutoOpen: boolean;
    } | null = null;

    const releaseRadioHeaders = (): void => {
        streamHeaders.clear(radioHeaderScopeUrl);
        radioHeaderScopeUrl = null;
    };

    const hydrateSelectedM3uPrograms = async (
        item: UnifiedCollectionItem,
        detail: ResolvedLiveCollectionDetail,
        generation: number
    ): Promise<void> => {
        if (detail.epgMode !== 'm3u' || detail.channel?.radio === 'true') {
            return;
        }

        const epgPrograms = await streamResolver.loadM3uProgramsForItem(
            item,
            detail.channel
        );
        if (generation !== options.generation.current()) {
            return;
        }

        options.activeDetail.update((currentDetail) => {
            if (!currentDetail || currentDetail.epgMode !== 'm3u') {
                return currentDetail;
            }

            return { ...currentDetail, epgPrograms };
        });
    };

    const close = (): void => {
        options.generation.next();
        pendingActivation = null;
        options.isSelecting.set(false);
        options.activeDetail.set(null);
        options.activeUid.set(null);
        options.activeItem.set(null);
        options.activeTimeshift.set(null);
        // Radio credentials must not outlive the closed player; the service
        // no-ops when a newer playback already owns the override slot.
        releaseRadioHeaders();
    };

    async function activate(
        item: UnifiedCollectionItem,
        isAutoOpen = false,
        startPlayback = false
    ): Promise<void> {
        const activeDetail = options.activeDetail();
        // The row is on screen only when it is both the highlight and the
        // resolved item: while a replacement resolves, `activeUid` already
        // points at it but `activeDetail` still belongs to the retained
        // stream, and launching that here would open the wrong channel.
        if (
            options.activeUid() === item.uid &&
            options.activeItem()?.uid === item.uid &&
            activeDetail
        ) {
            if (
                startPlayback &&
                options.shouldOpenExternalPlayback(activeDetail, true)
            ) {
                void portalPlayer.openResolvedPlayback(activeDetail.playback);
            }
            if (isAutoOpen) {
                options.onAutoOpenHandled();
            }
            return;
        }

        if (pendingActivation?.uid === item.uid && options.isSelecting()) {
            // The same row is still resolving: fold this activation's intent
            // into that request so its detail launches (or reports the
            // auto-open handled) when it lands, without a second round-trip.
            pendingActivation.startPlayback ||= startPlayback;
            pendingActivation.isAutoOpen ||= isAutoOpen;
            return;
        }

        const generation = options.generation.next();
        const activation = { uid: item.uid, startPlayback, isAutoOpen };
        pendingActivation = activation;
        options.activeUid.set(item.uid);
        options.isSelecting.set(true);
        // A previously owned radio override must not survive into a
        // selection that never mounts a player surface of its own — external
        // video playback and failed resolutions would otherwise keep the old
        // radio credentials installed for that origin.
        releaseRadioHeaders();

        try {
            const detail =
                item.sourceType === 'm3u'
                    ? await streamResolver.resolveM3uPlaybackDetail(item)
                    : await streamResolver.resolveLiveDetail(item);
            if (generation !== options.generation.current()) {
                return;
            }

            if (item.radio === 'true') {
                // Radio renders the dedicated audio player, never
                // WebPlayerViewComponent, so the scoped Electron header
                // override (portal cookie/token for auth-gated streams) is
                // configured here BEFORE the audio element gets the URL.
                // Ownership is claimed synchronously so a close/destroy
                // during the pending IPC can still clear the credentials.
                const headerSync = streamHeaders.apply(detail.playback);
                radioHeaderScopeUrl = detail.playback.streamUrl;
                const stillCurrent = headerSync ? await headerSync : true;
                if (
                    !stillCurrent ||
                    generation !== options.generation.current()
                ) {
                    return;
                }
            }

            options.activeTimeshift.set(null);
            options.activeItem.set(item);
            options.activeDetail.set(detail);

            if (options.supportsEpg && detail.epgMode === 'm3u') {
                void hydrateSelectedM3uPrograms(item, detail, generation);
            }

            if (
                options.shouldOpenExternalPlayback(
                    detail,
                    activation.startPlayback
                )
            ) {
                void portalPlayer.openResolvedPlayback(detail.playback);
            }

            try {
                const updatedItem = await recentData.recordLivePlayback(item);
                if (generation === options.generation.current()) {
                    options.onItemPlayed(updatedItem);
                }
            } catch {
                // Keep playback/EPG visible even if history persistence fails.
            }

            if (
                generation === options.generation.current() &&
                activation.isAutoOpen
            ) {
                options.onAutoOpenHandled();
            }
        } catch {
            if (generation === options.generation.current()) {
                // The fullscreen panel only offers video rows. Its previous
                // stream is still valid when resolution of a replacement
                // fails, so retain the player and its catch-up/session state.
                // Radio's scoped headers were released above; that path keeps
                // its existing reset behavior instead of reviving that scope.
                if (!activeDetail || options.isRadioDetail(activeDetail)) {
                    options.activeTimeshift.set(null);
                    options.activeDetail.set(null);
                    options.activeItem.set(null);
                }
                options.activeUid.set(options.activeItem()?.uid ?? null);
            }
        } finally {
            if (generation === options.generation.current()) {
                pendingActivation = null;
                options.isSelecting.set(false);
            }
        }
    }

    return {
        activate,
        close,
        dispose(): void {
            // Invalidate a playback continuation still awaiting its header
            // IPC and drop any radio credentials owned by this tab.
            options.generation.next();
            streamHeaders.clear(radioHeaderScopeUrl);
        },
    };
}
