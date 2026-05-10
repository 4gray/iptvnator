import { ClipboardModule } from '@angular/cdk/clipboard';
import { Component, inject, ViewEncapsulation } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { PlayerContentInfo, ResolvedPortalPlayback } from 'shared-interfaces';
import {
    type PlaybackFallbackRequest,
    WebPlayerViewComponent,
} from 'shared-portals';

export interface PlayerDialogData {
    streamUrl: string;
    title: string;
    contentInfo?: PlayerContentInfo;
    startTime?: number;
    playback?: ResolvedPortalPlayback;
}

@Component({
    templateUrl: './player-dialog.component.html',
    imports: [
        ClipboardModule,
        MatButton,
        MatDialogModule,
        MatIcon,
        MatTooltip,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    styleUrl: './player-dialog.component.scss',
    encapsulation: ViewEncapsulation.None,
})
export class PlayerDialogComponent {
    readonly data = inject<PlayerDialogData>(MAT_DIALOG_DATA);
    private snackBar = inject(MatSnackBar);
    private translateService = inject(TranslateService);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);

    readonly title: string;
    readonly streamUrl: string;

    private lastSaveTime = 0;

    constructor() {
        this.streamUrl = this.data.playback?.streamUrl ?? this.data.streamUrl;
        this.title = this.data.playback?.title ?? this.data.title;
    }

    handleTimeUpdate(event: { currentTime: number; duration: number }) {
        if (!this.data.contentInfo) return;

        const now = Date.now();
        // Save every 15 seconds
        if (now - this.lastSaveTime > 15000) {
            this.lastSaveTime = now;
            void this.playbackPositions.savePlaybackPosition(
                this.data.contentInfo.playlistId,
                {
                    ...this.data.contentInfo,
                    positionSeconds: Math.floor(event.currentTime),
                    durationSeconds: Math.floor(event.duration),
                }
            );
        }
    }

    showCopyNotification() {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            null,
            {
                duration: 2000,
            }
        );
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        void this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
    }
}
