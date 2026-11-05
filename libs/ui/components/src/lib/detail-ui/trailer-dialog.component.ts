import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { DialogShellComponent } from '../dialog-shell/dialog-shell.component';
import { DialogFooterDirective } from '../dialog-shell/dialog-shell.directives';

export interface TrailerDialogData {
    /** A `youtube-nocookie.com/embed/...` URL, see `youtubeEmbedUrl`. */
    readonly embedUrl: string;
    readonly title: string;
}

/**
 * The trailer, as a 16:9 YouTube embed in a modal over the details column,
 * in the dialog shell: the heading names it, the frame fills the body and
 * the footer keeps a Close beside the header's.
 */
@Component({
    selector: 'app-trailer-dialog',
    imports: [
        DialogFooterDirective,
        DialogShellComponent,
        MatDialogModule,
        MatButtonModule,
        TranslatePipe,
    ],
    template: `
        <app-dialog-shell
            [heading]="
                'PORTALS.DETAIL.TRAILER_OF' | translate: { title: data.title }
            "
        >
            <div class="trailer__frame">
                <iframe
                    class="trailer__iframe"
                    [src]="embedUrl"
                    [title]="data.title"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerpolicy="strict-origin-when-cross-origin"
                    allowfullscreen
                ></iframe>
            </div>
            <div appDialogFooter>
                <button
                    mat-button
                    type="button"
                    mat-dialog-close
                    data-test-id="trailer-dialog-close"
                >
                    {{ 'CLOSE' | translate }}
                </button>
            </div>
        </app-dialog-shell>
    `,
    styles: `
        :host {
            display: block;
        }

        // The 16:9 frame fills the body edge to edge: it cancels the
        // body's 20px padding.
        .trailer__frame {
            position: relative;
            margin: -20px;
            aspect-ratio: 16 / 9;
            background: #000;
        }

        .trailer__iframe {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            border: 0;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrailerDialogComponent {
    readonly data = inject<TrailerDialogData>(MAT_DIALOG_DATA);
    readonly embedUrl: SafeResourceUrl = inject(
        DomSanitizer
    ).bypassSecurityTrustResourceUrl(withAutoplay(this.data.embedUrl));
}

function withAutoplay(embedUrl: string): string {
    try {
        const url = new URL(embedUrl);
        url.searchParams.set('autoplay', '1');
        return url.toString();
    } catch {
        return embedUrl;
    }
}
