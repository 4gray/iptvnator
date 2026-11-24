import { Clipboard } from '@angular/cdk/clipboard';
import { inject, Injectable } from '@angular/core';
import { NotificationService } from '@iptvnator/services/notifications';

/** Clipboard feedback only; the host owns source identity and URL resolution. */
@Injectable({ providedIn: 'root' })
export class EpgArchiveCopyService {
    private readonly clipboard = inject(Clipboard);
    private readonly notifications = inject(NotificationService);
    private requestGeneration = 0;

    async copy(
        resolve: () => string | null | Promise<string | null>
    ): Promise<void> {
        const generation = ++this.requestGeneration;
        let copied = false;
        try {
            const url = await resolve();
            if (generation !== this.requestGeneration) return;
            if (url && ['http:', 'https:'].includes(new URL(url).protocol)) {
                copied = this.clipboard.copy(url);
            }
        } catch {
            // Provider URLs and error messages may contain credentials.
        }
        if (generation !== this.requestGeneration) return;
        if (copied) {
            this.notifications.success('EPG.PROGRAM_DIALOG.ARCHIVE_URL_COPIED');
        } else {
            this.notifications.error('EPG.PROGRAM_DIALOG.ARCHIVE_URL_FAILED');
        }
    }
}
