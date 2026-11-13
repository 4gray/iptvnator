import { DOCUMENT, inject, provideAppInitializer } from '@angular/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util/tokens';
import type {
    PlaybackPositionData,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { parseActivityAddress } from '@iptvnator/shared/interfaces/activity-sync';

const checkpointEvent = 'iptvnator:android-playback-checkpoint';

type Checkpoint = {
    id: string;
    content: string;
    positionMs: number;
    durationMs: number;
    savedAt: number;
};

export function provideAndroidPlaybackCheckpoint() {
    return provideAppInitializer(() => {
        const window = inject(DOCUMENT).defaultView as
            | (Window & { TvShell?: { postMessage(message: string): void } })
            | null;
        const shell = window?.TvShell;
        if (!window || !shell || typeof shell.postMessage !== 'function')
            return;
        const positions = inject(PORTAL_PLAYBACK_POSITIONS);
        let pending: string | undefined;
        window.addEventListener(checkpointEvent, async (event) => {
            if (!(event instanceof CustomEvent)) return;
            const data = event.detail as Checkpoint | null;
            if (
                !data ||
                typeof data.id !== 'string' ||
                !/^[a-f0-9-]{36}$/.test(data.id) ||
                pending !== undefined
            )
                return;
            pending = data.id;
            try {
                const position = readCheckpoint(data);
                if (position) {
                    const [playlistId, record] = position;
                    const previous = await positions.getPlaybackPosition(
                        playlistId,
                        record.contentXtreamId,
                        record.contentType
                    );
                    const previousSavedAt = Date.parse(
                        previous?.updatedAt ?? ''
                    );
                    if (
                        !Number.isFinite(previousSavedAt) ||
                        previousSavedAt < data.savedAt
                    )
                        await positions.savePlaybackPositionOrThrow(
                            playlistId,
                            record
                        );
                }
                shell.postMessage(
                    JSON.stringify([
                        'acknowledgeNativePlaybackCheckpoint',
                        data.id,
                    ])
                );
            } catch {
                // Keep the checkpoint in Android until a page can persist it.
            } finally {
                pending = undefined;
            }
        });
    });
}

function readCheckpoint(
    data: Checkpoint
): [string, PlaybackPositionData] | null {
    if (
        typeof data.content !== 'string' ||
        data.content.length > 8192 ||
        !Number.isSafeInteger(data.positionMs) ||
        !Number.isSafeInteger(data.durationMs) ||
        !Number.isSafeInteger(data.savedAt) ||
        data.positionMs < 0 ||
        data.durationMs <= 0 ||
        data.positionMs > data.durationMs ||
        data.savedAt <= 0
    )
        return null;
    try {
        const info = JSON.parse(data.content) as PlayerContentInfo | null;
        if (
            !info ||
            typeof info.playlistId !== 'string' ||
            !info.playlistId ||
            !Number.isSafeInteger(info.contentXtreamId) ||
            (info.contentType !== 'vod' && info.contentType !== 'episode')
        )
            return null;
        const activityIdentity =
            info.activityIdentity &&
            parseActivityAddress({
                scope: 'shared',
                instanceId: 'local',
                sourceId: info.playlistId,
                sourceIncarnation: 'local',
                content: info.activityIdentity,
            }).content;
        return [
            info.playlistId,
            {
                playlistId: info.playlistId,
                contentXtreamId: info.contentXtreamId,
                contentType: info.contentType,
                seriesXtreamId: optionalInteger(info.seriesXtreamId),
                seasonNumber: optionalInteger(info.seasonNumber),
                episodeNumber: optionalInteger(info.episodeNumber),
                activitySessionId:
                    typeof info.activitySessionId === 'string'
                        ? info.activitySessionId
                        : undefined,
                activityIdentity,
                positionSeconds: Math.floor(data.positionMs / 1000),
                durationSeconds: Math.floor(data.durationMs / 1000),
            },
        ];
    } catch {
        return null;
    }
}

function optionalInteger(value: number | undefined): number | undefined {
    return Number.isSafeInteger(value) ? value : undefined;
}
