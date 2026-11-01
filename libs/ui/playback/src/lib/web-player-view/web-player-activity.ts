import type { PlaybackActivityEvents } from '@iptvnator/services/activity-events';
import type {
    PlaybackPositionData,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';

/** Saves only owned non-live media; a new session never inherits the old snapshot. */
export class WebPlayerActivity {
    private latest?: PlaybackPositionData;
    private last?: PlaybackPositionData;
    private savedAt = 0;
    private session?: string;
    private resumeSettled = false;
    constructor(private readonly activity: PlaybackActivityEvents | null) {}
    begin(playback: ResolvedPortalPlayback | null): void {
        if (!playback?.contentInfo || playback.isLive) {
            this.flush();
            this.latest = undefined;
            this.session = undefined;
            this.resumeSettled = false;
            return;
        }
        if (this.session !== playback.contentInfo.activitySessionId) {
            this.flush();
            this.latest = undefined;
            this.resumeSettled = false;
        }
        void this.activity
            ?.begin(playback.contentInfo, playback.startTime, playback.title)
            .catch(() => undefined);
        this.session = playback.contentInfo.activitySessionId;
    }
    record(
        playback: ResolvedPortalPlayback | null,
        event: PlayerTimeUpdate
    ): boolean {
        const info = playback?.contentInfo;
        if (!info?.activitySessionId || !this.activity?.active()) return true;
        if (!this.resumeSettled) {
            const start = playback?.startTime ?? 0;
            const reachable = !(event.duration > 0) || start < event.duration;
            if (reachable && start > 0 && event.currentTime < start - 5)
                return false;
            this.resumeSettled = true;
        }
        this.last = {
            ...info,
            positionSeconds: event.currentTime,
            durationSeconds: event.duration,
        };
        this.latest = this.last;
        if (Date.now() - this.savedAt >= 5000 || event.playing === false)
            this.flush();
        return true;
    }
    finish(): void {
        const duration = this.latest?.durationSeconds;
        if (this.latest && duration && Number.isFinite(duration))
            this.last = { ...this.latest, positionSeconds: duration };
        this.flush();
    }
    flush(): void {
        if (!this.last) return;
        const position = this.last;
        this.last = undefined;
        this.savedAt = Date.now();
        void this.activity?.checkpoint(position).catch(() => undefined);
    }
}
