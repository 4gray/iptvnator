import { inject, Injectable } from '@angular/core';
import { NotificationService } from '@iptvnator/services/notifications';
import { DownloadsService, type DownloadStartInput } from '@iptvnator/services';

@Injectable({ providedIn: 'root' })
export class EpgArchiveDownloadService {
    private readonly downloads = inject(DownloadsService);
    private readonly notifications = inject(NotificationService);
    private readonly pending = new Set<string>();

    async start(
        input: Omit<DownloadStartInput, 'url' | 'contentType'>,
        resolve: () => Promise<string>
    ): Promise<void> {
        if (!this.downloads.isAvailable()) return;
        const key = JSON.stringify([
            input.playlistId,
            input.xtreamId,
            input.catchup?.startTimestamp,
            input.catchup?.stopTimestamp,
        ]);
        if (this.pending.has(key)) return;
        this.pending.add(key);
        let message = 'ARCHIVE_DOWNLOAD_FAILED';
        try {
            const url = await resolve();
            const parsed = new URL(url);
            let hls = false;
            parsed.searchParams.forEach((value) => {
                if (/^m3u8$/i.test(value)) hls = true;
            });
            if (/\.m3u8$/i.test(parsed.pathname) || hls) {
                message = 'ARCHIVE_DOWNLOAD_TS_ONLY';
            } else {
                const result = await this.downloads.startDownload({
                    ...input,
                    url,
                    contentType: 'catchup',
                });
                if (result.success) message = 'ARCHIVE_DOWNLOAD_QUEUED';
                else if (
                    result.reason === 'already-in-progress' ||
                    result.reason === 'already-downloaded'
                ) {
                    message = 'ARCHIVE_DOWNLOAD_EXISTS';
                }
            }
        } catch {
            // Neither URLs nor provider error messages are suitable for a toast.
        } finally {
            this.pending.delete(key);
        }
        const messageKey = `EPG.PROGRAM_DIALOG.${message}`;
        if (message === 'ARCHIVE_DOWNLOAD_QUEUED') {
            this.notifications.success(messageKey);
        } else if (message === 'ARCHIVE_DOWNLOAD_FAILED') {
            this.notifications.error(messageKey);
        } else {
            this.notifications.info(messageKey);
        }
    }
}
