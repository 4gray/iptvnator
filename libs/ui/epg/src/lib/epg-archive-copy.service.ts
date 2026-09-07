import { Clipboard } from '@angular/cdk/clipboard';
import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';

/** Clipboard feedback only; the host owns source identity and URL resolution. */
@Injectable({ providedIn: 'root' })
export class EpgArchiveCopyService {
    private readonly clipboard = inject(Clipboard);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private pending = false;

    async copy(
        resolve: () => string | null | Promise<string | null>
    ): Promise<void> {
        if (this.pending) return;
        this.pending = true;
        let copied = false;
        try {
            const url = await resolve();
            if (url && ['http:', 'https:'].includes(new URL(url).protocol)) {
                copied = this.clipboard.copy(url);
            }
        } catch {
            // Provider URLs and error messages may contain credentials.
        } finally {
            this.pending = false;
        }
        this.snackBar.open(
            this.translate.instant(
                copied
                    ? 'EPG.PROGRAM_DIALOG.ARCHIVE_URL_COPIED'
                    : 'EPG.PROGRAM_DIALOG.ARCHIVE_URL_FAILED'
            ),
            undefined,
            { duration: 4000 }
        );
    }
}
