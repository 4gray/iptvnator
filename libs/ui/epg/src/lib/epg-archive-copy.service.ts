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
