import type { OutputEmitterRef } from '@angular/core';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import type { PlaybackHistoryConfirmation } from '../playback-history/playback-history-confirmation';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';
import type { PlaybackRecoverySession } from './playback-recovery-session';
import type { WebPlayerActivity } from './web-player-activity';
import type { PlaybackApplicationOwnership } from './web-player-application-ownership';
import type { WebPlayerApplicationToken } from './web-player-application-state';
import type { WebPlayerRecoveryController } from './web-player-recovery-controller';

interface WebPlayerPlaybackEventDeps {
    readonly recovery: WebPlayerRecoveryController;
    readonly recoverySession: PlaybackRecoverySession;
    readonly activity: WebPlayerActivity;
    readonly history: PlaybackHistoryConfirmation;
    readonly owns: (ownership: PlaybackApplicationOwnership) => boolean;
    readonly playback: () => ResolvedPortalPlayback | null;
    readonly resolvedPlayback: () => ResolvedPortalPlayback;
    readonly isLive: () => boolean;
    readonly startTime: () => number;
    readonly token: () => WebPlayerApplicationToken;
    readonly timeUpdate: OutputEmitterRef<PlayerTimeUpdate>;
    readonly started: OutputEmitterRef<ResolvedPortalPlayback>;
    readonly ended: OutputEmitterRef<void>;
}

/** Records and forwards playback events from owned web and Android players. */
export class WebPlayerPlaybackEvents {
    constructor(private readonly deps: WebPlayerPlaybackEventDeps) {}

    readonly webPosition = (
        update: PlayerTimeUpdate,
        ownership: PlaybackApplicationOwnership
    ): void => {
        const { activity, history, owns, playback, recovery, recoverySession } =
            this.deps;
        if (!owns(ownership)) return;
        const { isLive, token } = ownership;
        if (recovery.recordTimeUpdate(token, update.playing)) this.start();
        history.record(update.currentTime, update.playing);
        if (
            !recoverySession.recordTimeUpdate(
                update,
                isLive,
                this.deps.startTime()
            )
        ) {
            return;
        }
        if (!isLive && !activity.record(playback(), update)) return;
        this.deps.timeUpdate.emit(update);
    };

    readonly webEnded = (
        ownership: PlaybackApplicationOwnership,
        notify = true
    ): void => {
        if (this.deps.owns(ownership)) this.end(ownership.isLive, notify);
    };

    androidStarted(seconds: number, confirm: boolean): void {
        this.deps.history.recordPlayedTime(seconds);
        if (confirm && this.deps.recovery.confirmAndroidStart()) this.start();
    }

    androidPosition(update: PlayerTimeUpdate, replayTime: number): void {
        const { activity, playback, recoverySession, isLive } = this.deps;
        activity.record(playback(), update);
        recoverySession.recordTimeUpdate(
            { ...update, currentTime: replayTime },
            isLive()
        );
        this.deps.timeUpdate.emit(update);
    }

    end(isLive: boolean, notify = true): void {
        if (!isLive) this.deps.activity.finish();
        this.deps.recovery.recordEnd(this.deps.token());
        if (notify) this.deps.ended.emit();
    }

    private start(): void {
        this.deps.started.emit(
            this.deps.playback() ?? this.deps.resolvedPlayback()
        );
    }
}
