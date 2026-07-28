import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistFileImportService } from '@iptvnator/playlist/shared/util';
import type { ElectronBridgePlaylistOpenRequest } from '@iptvnator/shared/interfaces';

type PlaylistOpenRequestBridge = {
    acknowledgePlaylistOpenRequest?: (requestId: string) => Promise<void>;
    announcePlaylistOpenListener?: () => Promise<void>;
    onPlaylistOpenRequest?: (
        callback: (request: ElectronBridgePlaylistOpenRequest) => void
    ) => () => void;
};

/**
 * Imports playlist files the operating system handed to the app: a command
 * line argument, a file association double-click, or macOS' `open-file`.
 *
 * The main process queues those requests until this service announces itself,
 * so the listener has to be attached *before* the announcement — otherwise the
 * push that follows it has nowhere to land. Electron only; in the PWA the
 * bridge is absent and `start()` is a no-op.
 */
@Injectable({ providedIn: 'root' })
export class PlaylistOpenRequestService {
    private readonly importService = inject(PlaylistFileImportService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);

    private started = false;
    private unsubscribe: (() => void) | undefined;

    /**
     * Imports run strictly one after another, in arrival order. The main
     * process flushes its queue back to back, so without this a burst — two
     * playlists picked in Finder at once — would fan out into parallel
     * file reads and land in a nondeterministic order, with an arbitrary one
     * of them ending up the active playlist. `addPlaylist$` serialises the
     * persistence side separately.
     */
    private importChain: Promise<void> = Promise.resolve();

    start(): void {
        if (this.started) {
            return;
        }

        const bridge = this.getBridge();
        if (!bridge?.announcePlaylistOpenListener) {
            return;
        }

        this.started = true;

        // Subscribe first: announcing makes the main process flush its queue
        // immediately, and every request — queued or live — arrives this way.
        this.unsubscribe = bridge.onPlaylistOpenRequest?.((request) => {
            // Acknowledge on receipt rather than after the import: the main
            // process only needs to know the request reached a live renderer,
            // and holding the ack back until a slow import finished would
            // replay it if the window were closed meanwhile.
            void bridge
                .acknowledgePlaylistOpenRequest?.(request?.requestId)
                .catch(() => undefined);
            this.chain(() => this.open(request));
        });

        void bridge.announcePlaylistOpenListener().catch((error) => {
            console.error(
                'Failed to announce the playlist open listener:',
                error
            );
        });
    }

    /** Appends a step to the import chain, never breaking it on failure. */
    private chain(step: () => Promise<void>): void {
        this.importChain = this.importChain.then(step).catch((error) => {
            console.error('Failed to open a playlist file:', error);
        });
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.started = false;
    }

    private async open(
        request: ElectronBridgePlaylistOpenRequest
    ): Promise<void> {
        if (!request?.filePath) {
            return;
        }

        const result = await this.importService.importFromPath(
            request.filePath,
            request.fileName
        );

        if (result.ok) {
            return;
        }

        this.snackBar.open(
            this.translate.instant('HOME.FILE_UPLOAD.OPEN_FAILED', {
                filename: request.fileName || request.filePath,
            }),
            this.translate.instant('CLOSE'),
            { duration: 7000, panelClass: ['error-snackbar'] }
        );
    }

    private getBridge(): PlaylistOpenRequestBridge | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return (window as Window & { electron?: PlaylistOpenRequestBridge })
            .electron;
    }
}
