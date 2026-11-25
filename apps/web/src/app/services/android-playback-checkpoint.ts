import { activityEnabled } from './activity-consent';
import { playbackTimestamp } from '@iptvnator/shared/interfaces';
import { inject } from '@angular/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util/tokens';
import { announceActivityChange } from '@iptvnator/services/activity-changes';
import { USER_DATA_STORAGE, XTREAM_USER_DATA_KEYS } from '@iptvnator/services';
import {
    nativePlaybackEpisodeResetKey,
    nativePlaybackResetKey,
} from '@iptvnator/services/pwa-native-playback-resets';
import { sourceProfileName } from '@iptvnator/services/source-sync/connection';
import { activePersonalScope } from '@iptvnator/services/profiles';
import {
    DEFAULT_PERSONAL_SCOPE,
    parsePersonalScope,
    type PersonalScope,
} from '@iptvnator/shared/interfaces/profiles';
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
    window.addEventListener(
        'iptvnator:android-playback-checkpoints-idle',
        (event) => {
            if (!(event instanceof CustomEvent) || !ownsProfile()) return;
            if (event.detail !== null && typeof event.detail !== 'string')
                return;
            const requestId = window.iptvnatorAndroidCheckpointRequestId;
            // A queued idle notification cannot clear markers for a newer launch.
            if (requestId && requestId !== event.detail) return;
            window.iptvnatorAndroidCheckpointRequestId = null;
            try {
                const key = XTREAM_USER_DATA_KEYS.playbackPositions;
                const raw = storage.getItem(key);
                if (
                    !raw ||
                    (!raw.includes(nativePlaybackResetKey) &&
                        !raw.includes(nativePlaybackEpisodeResetKey))
                )
                    return;
                const positions = JSON.parse(raw);
                delete positions[nativePlaybackResetKey];
                delete positions[nativePlaybackEpisodeResetKey];
                storage.setItem(key, JSON.stringify(positions));
            } catch {
                // Existing progress remains readable if cleanup cannot run.
            }
        }
    );
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
        // A checkpoint belongs to the profile that launched it, never to whoever is active now.
        if (
            !ownsProfile() ||
            (position &&
                (position.profile !== profile ||
                    position.personalScope !== activePersonalScope()))
        )
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
                    const { playlistId, record } = position;
                    // Shared playback compares capture times when committing the position.
                    const previous =
                        record.activitySessionId && activityEnabled()
                            ? null
                            : await positions.getPlaybackPosition(
                                  playlistId,
                                  record.contentXtreamId,
                                  record.contentType
                              );
                    if (!ownsProfile() || (newest.get(key) ?? 0) > data.savedAt)
                        return;
                    const previousSavedAt = playbackTimestamp(
                        previous?.updatedAt
                    );
                    if (
                        androidPlaybackResetAt(storage, playlistId, record) <
                            data.savedAt &&
                        previousSavedAt < data.savedAt
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
    personalScope: PersonalScope;
    playlistId: string;
    record: PlaybackPositionData;
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
            | (PlayerContentInfo & {
                  profile?: string;
                  personalScope?: string;
                  seasonGroup?: number;
              })
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
            // A launch before profiles carries no scope: it is the Default's.
            personalScope: parsePersonalScope(
                info.personalScope ?? DEFAULT_PERSONAL_SCOPE
            ),
            playlistId: info.playlistId,
            record: {
                playlistId: info.playlistId,
                contentXtreamId: info.contentXtreamId,
                contentType: info.contentType,
                seriesXtreamId: optionalInteger(info.seriesXtreamId),
                seasonNumber: optionalInteger(info.seasonNumber),
                ...(info.seasonGroup === undefined
                    ? {}
                    : {
                          nativeCheckpointSeasonGroup: optionalInteger(
                              info.seasonGroup
                          ),
                      }),
                episodeNumber: optionalInteger(info.episodeNumber),
                activitySessionId:
                    typeof info.activitySessionId === 'string'
                        ? info.activitySessionId
                        : undefined,
                activityIdentity,
                nativeCheckpointAt: new Date(data.savedAt).toISOString(),
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
