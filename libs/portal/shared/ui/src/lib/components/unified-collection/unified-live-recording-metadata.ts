import { computed, inject, Signal } from '@angular/core';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { RecordingsService } from '@iptvnator/services';
import {
    buildStalkerEpgMappingKey,
    buildXtreamEpgMappingKey,
    EpgProgram,
    epgProviderClockMs,
    filterRecordingProgramsOverlap,
    playlistDisplayLabel,
    RecordingStartMetadata,
    RecordingStoppedEvent,
    toRecordingProgramSnapshot,
} from '@iptvnator/shared/interfaces';

export interface UnifiedLiveRecording {
    /** Channel/EPG snapshot for the embedded-MPV recording tracker. */
    readonly metadata: Signal<RecordingStartMetadata | null>;
    /** Stop enrichment: programs overlapping the recorded window. */
    handleRecordingStopped(event: RecordingStoppedEvent): void;
}

/**
 * What a live recording started from this tab records about its channel.
 * Provider EPG never reaches SQLite, so the schedule can only be captured
 * while the stream is on screen. Must run in an injection context.
 */
export function createUnifiedLiveRecording(options: {
    activeItem: Signal<UnifiedCollectionItem | null>;
    timelinePrograms: Signal<EpgProgram[]>;
    timelineChannelLogo: Signal<string>;
    epgOffsetMinutes: Signal<number>;
    /** 30 s tick; see `metadata`. */
    progressTick: Signal<number>;
}): UnifiedLiveRecording {
    const recordingsService = inject(RecordingsService);

    const metadata = computed<RecordingStartMetadata | null>(() => {
        const item = options.activeItem();
        if (!item) {
            return null;
        }
        // Track the 30 s tick: without it this computed caches its
        // Date.now() verdict, and a recording started after an EPG boundary
        // would snapshot the previous show.
        options.progressTick();
        // Raw programme times vs. now in the provider's EPG clock, like the
        // panel summary — the start snapshot is authoritative for the
        // recording's title, so it must name the same programme.
        const now = epgProviderClockMs(Date.now(), options.epgOffsetMinutes());
        const program =
            options.timelinePrograms().find((candidate) => {
                const start = Date.parse(candidate.start);
                const stop = Date.parse(candidate.stop);
                return (
                    Number.isFinite(start) &&
                    Number.isFinite(stop) &&
                    start <= now &&
                    now < stop
                );
            }) ?? null;
        return {
            channelName: item.name?.trim() || 'Live TV',
            channelLogoUrl:
                options.timelineChannelLogo() || item.logo || undefined,
            playlistId: item.playlistId,
            playlistName: playlistDisplayLabel(item.playlistName) || undefined,
            sourceType: item.sourceType,
            epgChannelId: resolveRecordingEpgChannelId(item),
            // The EPG key is not unique for M3U items (shared tvgId, or the
            // display-name fallback); the uid names the exact selection.
            sourceItemKey: item.uid,
            currentProgram: program
                ? toRecordingProgramSnapshot(program)
                : undefined,
        };
    });

    return {
        metadata,
        handleRecordingStopped(event: RecordingStoppedEvent): void {
            // A channel switch auto-stops the recording, and by now this host
            // already describes the new channel — enriching then would attach
            // the wrong schedule (and could promote an unrelated program to
            // the recording's title).
            if (
                event.epgChannelId &&
                event.epgChannelId !== metadata()?.epgChannelId
            ) {
                return;
            }
            // The EPG key alone cannot tell two same-keyed M3U items apart —
            // the uid must also match the exact recorded selection.
            if (
                event.sourceItemKey &&
                event.sourceItemKey !== metadata()?.sourceItemKey
            ) {
                return;
            }
            const programs = filterRecordingProgramsOverlap(
                options.timelinePrograms().map(toRecordingProgramSnapshot),
                event.startedAt,
                event.endedAt,
                options.epgOffsetMinutes()
            );
            if (programs.length === 0) {
                return;
            }
            void recordingsService.updatePrograms(event.targetPath, programs);
        },
    };
}

function resolveRecordingEpgChannelId(
    item: UnifiedCollectionItem
): string | undefined {
    switch (item.sourceType) {
        case 'm3u':
            return item.tvgId?.trim() || item.name?.trim() || undefined;
        case 'xtream':
            return item.xtreamId !== undefined
                ? buildXtreamEpgMappingKey(item.playlistId, item.xtreamId)
                : undefined;
        case 'stalker':
            return item.stalkerId !== undefined
                ? buildStalkerEpgMappingKey(
                      item.playlistId,
                      String(item.stalkerId)
                  )
                : undefined;
    }
}
