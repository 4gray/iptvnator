import {
    effect,
    untracked,
    type Signal,
    type WritableSignal,
} from '@angular/core';
import type { Channel, VideoPlayer } from '@iptvnator/shared/interfaces';
import type { VideoPlayerOptions } from '../vjs-player/vjs-player.types';
import type { PlaybackRecoverySession } from './playback-recovery-session';
import type { WebPlayerApplicationHandoffCoordinator } from './web-player-application-handoff';
import type { createWebPlayerApplicationState } from './web-player-application-state';
import type { WebPlayerRecoveryController } from './web-player-recovery-controller';

export function bindWebPlayerApplication(options: {
    recovery: WebPlayerRecoveryController;
    session: PlaybackRecoverySession;
    handoff: WebPlayerApplicationHandoffCoordinator;
    pending: Signal<boolean>;
    application: ReturnType<typeof createWebPlayerApplicationState>;
    player: Signal<VideoPlayer>;
    reloadToken: Signal<number>;
    channel: WritableSignal<Channel | undefined>;
    vjsOptions: WritableSignal<VideoPlayerOptions | undefined>;
}): void {
    const { recovery, session, handoff, channel, vjsOptions, application } =
        options;
    effect(() => {
        // Session sync can clear a temporary override before we track intent.
        recovery.syncSession();
        if (options.pending()) return;
        void recovery.diagnosticIntentToken();
        const sourceRevision = application.sourceRevision();
        untracked(() => session.syncSourceRevision(sourceRevision));
        const token = application.token();
        const playback = untracked(application.playback);
        const isLive = untracked(application.isLive);
        const selectedPlayer = untracked(options.player);
        const reloadToken = untracked(options.reloadToken);
        channel.set(undefined);
        vjsOptions.set(undefined);
        recovery.clearDiagnostic();
        handoff.apply(
            playback,
            isLive,
            reloadToken,
            selectedPlayer,
            token,
            application.token,
            (next) => {
                channel.set(next.channel);
                vjsOptions.set(next.vjsOptions);
            }
        );
    });
}
