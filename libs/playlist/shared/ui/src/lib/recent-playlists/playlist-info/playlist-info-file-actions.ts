import { Clipboard } from '@angular/cdk/clipboard';
import { inject } from '@angular/core';
import { NotificationService } from '@iptvnator/services/notifications';
import { TranslateService } from '@ngx-translate/core';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';

type DesktopFileSaveBridge = Pick<
    typeof window.electron,
    'saveFileDialog' | 'writeFile'
>;

/** Existing export/copy behaviour, kept separate from metadata and EPG edits. */
export class PlaylistInfoFileActions {
    private readonly clipboard = inject(Clipboard);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly notifications = inject(NotificationService);
    private readonly translate = inject(TranslateService);
    constructor(
        private readonly readPlaylist: () => PlaylistMeta,
        private readonly readUrl: () => string | undefined
    ) {}
    private get playlist() {
        return this.readPlaylist();
    }

    async exportPlaylist() {
        const playlistAsString = await firstValueFrom(
            this.playlistsService.getRawPlaylistById(this.playlist._id)
        );

        if (this.runtime.supportsDesktopFileSave) {
            const desktopFileBridge = window.electron as DesktopFileSaveBridge;

            try {
                const savePath = await desktopFileBridge.saveFileDialog(
                    `${this.playlist.title || 'exported'}.m3u8`,
                    [
                        {
                            name: this.translate.instant(
                                'HOME.PLAYLISTS.INFO_DIALOG.EXPORT_FILE_TYPE'
                            ),
                            extensions: ['m3u8', 'm3u'],
                        },
                    ]
                );

                if (savePath) {
                    await desktopFileBridge.writeFile(
                        savePath,
                        playlistAsString
                    );
                    this.notifications.success(
                        'HOME.PLAYLISTS.INFO_DIALOG.PLAYLIST_EXPORT_SUCCESS'
                    );
                }

                return;
            } catch (error) {
                console.error('Failed to export playlist:', error);
                this.notifications.error(
                    'HOME.PLAYLISTS.INFO_DIALOG.EXPORT_PLAYLIST_FAILED'
                );
                return;
            }
        }

        this.downloadPlaylistFile(playlistAsString);
    }

    private downloadPlaylistFile(playlistAsString: string): void {
        const element = document.createElement('a');
        element.setAttribute(
            'href',
            'data:text/plain;charset=utf-8,' +
                encodeURIComponent(playlistAsString)
        );
        element.setAttribute('download', this.playlist.title || 'exported.m3u');
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }

    /**
     * Copy URL to clipboard
     */
    copyUrl(): void {
        const url = this.readUrl();
        if (url) {
            const success = this.clipboard.copy(url);
            if (success) {
                this.notifications.success(
                    'HOME.PLAYLISTS.INFO_DIALOG.URL_COPIED'
                );
            }
        }
    }
}
