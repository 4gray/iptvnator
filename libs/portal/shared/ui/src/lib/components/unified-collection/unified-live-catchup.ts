import { computed, inject, Signal, WritableSignal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { resolveM3uCatchupUrl } from '@iptvnator/shared/m3u-utils';
import {
    ResolvedLiveCollectionDetail,
    StreamResolverService,
} from '@iptvnator/portal/shared/data-access';
import {
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    EpgArchiveCopyService,
    EpgProgramActivationEvent,
} from '@iptvnator/ui/epg';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import { toEpochSeconds } from './unified-live-epg-summary.util';
import { UnifiedLiveSelectionGeneration } from './unified-live-selection-generation';

/** Catch-up override for the active channel; `null` = live playback. */
export interface UnifiedLiveTimeshift {
    url: string;
    program: EpgProgram;
}

export interface UnifiedLiveCatchup {
    readonly activeProgram: Signal<EpgProgram | null>;
    /** Act on a programme picked in the timeline or the list view. */
    handleProgramActivation(event: EpgProgramActivationEvent): void;
    returnToLive(): void;
}

/**
 * Catch-up playback for the live tab: turning a programme from the EPG
 * panel into a timeshift URL, and getting back to the live edge. The
 * override itself lives on the host, because the selection session has to
 * swap it together with the detail it belongs to.
 *
 * Must run in an injection context (the hosting component's field
 * initializer or constructor).
 */
export function createUnifiedLiveCatchup(options: {
    activeTimeshift: WritableSignal<UnifiedLiveTimeshift | null>;
    activeItem: Signal<UnifiedCollectionItem | null>;
    activeDetail: Signal<ResolvedLiveCollectionDetail | null>;
    isM3uSelection: Signal<boolean>;
    currentM3uChannel: Signal<Channel | null>;
    shouldUseInlinePlayer: Signal<boolean>;
    /** Drops a portal resolution that landed after a channel switch. */
    generation: UnifiedLiveSelectionGeneration;
}): UnifiedLiveCatchup {
    const archiveCopy = inject(EpgArchiveCopyService);
    const streamResolver = inject(StreamResolverService);
    const portalPlayer = inject(PORTAL_PLAYER);
    const snackBar = inject(MatSnackBar);
    const translate = inject(TranslateService);

    const reportFailure = (): void => {
        snackBar.open(
            translate.instant('EPG.TIMELINE.CATCHUP_FAILED'),
            undefined,
            { duration: 4000 }
        );
    };

    /** Hand the resolved archive URL to whichever surface is playing. */
    const playArchive = (url: string, program: EpgProgram): void => {
        options.activeTimeshift.set({ url, program });

        const playback = options.activeDetail()?.playback;
        if (!options.shouldUseInlinePlayer() && playback) {
            void portalPlayer.openResolvedPlayback({
                ...playback,
                streamUrl: url,
                isLive: false,
            });
        }
    };

    /** M3U catch-up: resolve via the M3U timeshift URL resolver. */
    const activateM3uCatchup = (program: EpgProgram): void => {
        const playbackUrl = resolveM3uCatchupUrl(
            options.currentM3uChannel(),
            program
        );
        if (!playbackUrl) {
            reportFailure();
            return;
        }

        playArchive(playbackUrl, program);
    };

    /**
     * Portal (Xtream) catch-up: compute start/stop as epoch seconds and
     * resolve via the provider's timeshift endpoint.
     */
    const activatePortalCatchup = async (
        program: EpgProgram
    ): Promise<void> => {
        const generation = options.generation.current();
        const item = options.activeItem();
        const startEpoch = toEpochSeconds(
            program.startTimestamp,
            program.start
        );
        const stopEpoch = toEpochSeconds(program.stopTimestamp, program.stop);
        if (!item?.xtreamId || startEpoch == null || stopEpoch == null) {
            reportFailure();
            return;
        }

        const playbackUrl = await streamResolver.resolveXtreamCatchupUrl(
            item,
            startEpoch,
            stopEpoch
        );
        if (generation !== options.generation.current()) {
            return; // switched channel — discard silently
        }
        if (!playbackUrl) {
            reportFailure();
            return;
        }

        playArchive(playbackUrl, program);
    };

    const copyArchiveUrl = (program: EpgProgram): void => {
        const channel = options.currentM3uChannel();
        const item = options.activeItem();
        const isM3u = options.isM3uSelection();
        void archiveCopy.copy(() => {
            if (isM3u) return resolveM3uCatchupUrl(channel, program);
            const start = toEpochSeconds(program.startTimestamp, program.start);
            const stop = toEpochSeconds(program.stopTimestamp, program.stop);
            return item?.xtreamId &&
                start != null &&
                stop != null &&
                stop > start
                ? streamResolver.resolveXtreamCatchupUrl(item, start, stop)
                : null;
        });
    };

    const returnToLive = (): void => {
        options.activeTimeshift.set(null);

        // Inline player is already (back) on the live stream once the
        // timeshift override is cleared. With an external player configured,
        // "Watch live" must open it even when no archive was active — e.g.
        // openStreamOnDoubleClick shows the guide without launching playback.
        const playback = options.activeDetail()?.playback;
        if (!options.shouldUseInlinePlayer() && playback) {
            void portalPlayer.openResolvedPlayback(playback);
        }
    };

    return {
        activeProgram: computed(
            () => options.activeTimeshift()?.program ?? null
        ),
        handleProgramActivation(event: EpgProgramActivationEvent): void {
            if (event.type === 'copy-catchup-url') {
                copyArchiveUrl(event.program);
                return;
            }

            if (event.type === 'live') {
                returnToLive();
                return;
            }

            if (options.isM3uSelection()) {
                activateM3uCatchup(event.program);
            } else {
                void activatePortalCatchup(event.program);
            }
        },
        returnToLive,
    };
}
