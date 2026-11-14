import { inject } from '@angular/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util/tokens';
import { announceActivityChange } from '@iptvnator/services/activity-changes';
import { USER_DATA_STORAGE } from '@iptvnator/services';
import { sourceProfileName } from '@iptvnator/services/source-sync/connection';
import type {
    PlaybackPositionData,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { parseActivityAddress } from '@iptvnator/shared/interfaces/activity-sync';
import { androidPlaybackResetAt } from '@iptvnator/portal/xtream/data-access/android-playback-resets';

const checkpointEvent = 'iptvnator:android-playback-checkpoint';

type Checkpoint = {
    id: string;
    content: string;
    positionMs: number;
    durationMs: number;
    savedAt: number;
};

export function installAndroidPlaybackCheckpoint(
    window: Window,
    shell: { postMessage(message: string): void }
) {
    const positions = inject(PORTAL_PLAYBACK_POSITIONS);
    const storage = inject(USER_DATA_STORAGE);
    const profile = sourceProfileName();
    const ownsProfile = () => profile === sourceProfileName();
    const pending = new Set<string>();
    const newest = new Map<string, number>();
    let writes = Promise.resolve();
    window.addEventListener(checkpointEvent, (event) => {
        if (!(event instanceof CustomEvent)) return;
        const data = event.detail as Checkpoint | null;
        if (
            !data ||
            typeof data.id !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(data.id) ||
            pending.has(data.id)
        )
            return;
        const position = readCheckpoint(data);
        if (!ownsProfile() || (position && position.profile !== profile))
            return;
        pending.add(data.id);
        const key =
            position &&
            JSON.stringify([
                position.playlistId,
                position.record.contentType,
                position.record.contentXtreamId,
            ]);
        if (key) newest.set(key, Math.max(data.savedAt, newest.get(key) ?? 0));
        writes = writes
            .then(async () => {
                if (!ownsProfile()) return;
                if (position && key) {
                    // A failing newer checkpoint must still take priority over an older one.
                    if ((newest.get(key) ?? 0) > data.savedAt) return;
                    const { playlistId, record, seasonGroup } = position;
                    const previous = await positions.getPlaybackPosition(
                        playlistId,
                        record.contentXtreamId,
                        record.contentType
                    );
                    if (!ownsProfile() || (newest.get(key) ?? 0) > data.savedAt)
                        return;
                    const previousSavedAt = Date.parse(
                        previous?.updatedAt ?? ''
                    );
                    if (
                        androidPlaybackResetAt(
                            storage,
                            playlistId,
                            record,
                            seasonGroup
                        ) < data.savedAt &&
                        (!Number.isFinite(previousSavedAt) ||
                            previousSavedAt < data.savedAt)
                    ) {
                        await positions.savePlaybackPositionOrThrow(
                            playlistId,
                            record
                        );
                        announceActivityChange();
                    }
                    if (newest.get(key) === data.savedAt) newest.delete(key);
                }
                shell.postMessage(
                    JSON.stringify([
                        'acknowledgeNativePlaybackCheckpoint',
                        data.id,
                    ])
                );
            })
            .catch(() => {
                // Keep the checkpoint in Android until a page can persist it.
            })
            .finally(() => {
                pending.delete(data.id);
            });
    });
}

function readCheckpoint(data: Checkpoint): {
    profile: string;
    playlistId: string;
    record: PlaybackPositionData;
    seasonGroup?: number;
} | null {
    if (
        typeof data.content !== 'string' ||
        data.content.length > 8192 ||
        !Number.isSafeInteger(data.positionMs) ||
        !Number.isSafeInteger(data.durationMs) ||
        !Number.isSafeInteger(data.savedAt) ||
        data.positionMs < 0 ||
        data.durationMs < 0 ||
        (data.durationMs === 0 && data.positionMs === 0) ||
        (data.durationMs > 0 && data.positionMs > data.durationMs) ||
        data.savedAt <= 0 ||
        data.savedAt > 8_640_000_000_000_000
    )
        return null;
    try {
        const info = JSON.parse(data.content) as
            | (PlayerContentInfo & { profile?: string; seasonGroup?: number })
            | null;
        if (
            !info ||
            typeof info.profile !== 'string' ||
            !info.profile ||
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
        return {
            profile: info.profile,
            playlistId: info.playlistId,
            seasonGroup: optionalInteger(info.seasonGroup),
            record: {
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
                updatedAt: new Date(data.savedAt).toISOString(),
                positionSeconds: Math.floor(data.positionMs / 1000),
                durationSeconds:
                    Math.floor(data.durationMs / 1000) || undefined,
            },
        };
    } catch {
        return null;
    }
}

function optionalInteger(value: number | undefined): number | undefined {
    return Number.isSafeInteger(value) ? value : undefined;
}
