import { signal } from '@angular/core';
import type { SecondStreamSelection } from '@iptvnator/portal/shared/data-access';
import { createInlinePlaybackPositionWriter } from '@iptvnator/portal/shared/util';
import type { PlaybackActivityEvents } from '@iptvnator/services/activity-events';
import {
    createRandomId,
    type EmbeddedMpvSession,
    type PlaybackPositionData,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { PlaybackProgressConfirmation } from '../playback-history/playback-progress-confirmation';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';
import { WebPlayerActivity } from '../web-player-view/web-player-activity';

export class SecondStreamSlotProgress {
    readonly selection: SecondStreamSelection;
    private readonly activity: WebPlayerActivity;
    private readonly writer;
    private readonly history;

    constructor(
        selection: SecondStreamSelection,
        private readonly events: PlaybackActivityEvents | null,
        save: (playlistId: string, position: PlaybackPositionData) => void,
        recordHistory: () => void
    ) {
        const { playback } = selection;
        this.selection =
            playback.contentInfo && !playback.isLive
                ? {
                      ...selection,
                      playback: {
                          ...playback,
                          contentInfo: {
                              ...playback.contentInfo,
                              activitySessionId: createRandomId(),
                          },
                      },
                  }
                : selection;
        this.activity = new WebPlayerActivity(events);
        this.activity.begin(this.selection.playback);
        this.writer = createInlinePlaybackPositionWriter({
            playback: signal(this.selection.playback),
            save,
        });
        this.history = new PlaybackProgressConfirmation(recordHistory);
    }

    record(session: EmbeddedMpvSession, event: PlayerTimeUpdate): void {
        const { status, reconnect } = session;
        if (status !== 'playing' && status !== 'paused' && status !== 'ended')
            return;
        if (status === 'ended' && reconnect) {
            this.flush();
            return;
        }
        const playback = this.selection.playback;
        const sync =
            this.events?.active() && playback.contentInfo?.activitySessionId;
        if (Number.isFinite(event.currentTime) && event.currentTime > 0) {
            const accepted = sync
                ? this.activity.record(playback, event)
                : playback.isLive ||
                  !playback.contentInfo ||
                  this.writer.handleTimeUpdate(event);
            if (accepted)
                this.history.record(event.currentTime, status === 'playing');
        }
        if (sync && status === 'ended') this.activity.finish();
        if (status !== 'playing') this.flush();
    }

    flush(): void {
        this.activity.flush();
        this.writer.flush();
    }
}

export function samePositionKey(
    left: ResolvedPortalPlayback | null | undefined,
    right: ResolvedPortalPlayback
): boolean {
    const a = left?.contentInfo;
    const b = right.contentInfo;
    return Boolean(
        left &&
        !left.isLive &&
        !right.isLive &&
        a &&
        b &&
        a.playlistId === b.playlistId &&
        a.contentType === b.contentType &&
        a.contentXtreamId === b.contentXtreamId
    );
}
