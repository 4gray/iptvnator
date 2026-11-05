import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { ActivitySyncClient } from './activity-sync-client';
import { activityIdentityKey } from './activity-projection';

export interface FailedActivitySession {
    sourceId: string;
    incarnation?: string;
    position?: Pick<
        PlaybackPositionData,
        'contentType' | 'contentXtreamId' | 'activityIdentity'
    >;
}

/** A confirmed command retires failed fallback owners, including before their first tick. */
export function commitActivity(
    this: ActivitySyncClient,
    sourceId: string,
    position: Partial<PlaybackPositionData>,
    kind: 'begin' | 'checkpoint' | 'command'
): void {
    if (kind !== 'checkpoint')
        for (const [id, failed] of this.localSessions) {
            const local = failed.position;
            if (failed.sourceId !== sourceId || !local) continue;
            const same =
                local.activityIdentity && position.activityIdentity
                    ? activityIdentityKey(local.activityIdentity) ===
                      activityIdentityKey(position.activityIdentity)
                    : local.contentType === position.contentType &&
                      local.contentXtreamId === position.contentXtreamId;
            if (!same) continue;
            this.localSessions.delete(id);
            // Conflict resolution may explicitly reacquire this same player.
            if (!this.sessions.has(id)) this.retiredSessions.add(id);
        }
    this.options.committed?.(sourceId, position, kind);
}
