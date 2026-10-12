import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

export interface TrailerDialogData {
    /** A `youtube-nocookie.com/embed/...` URL, see `youtubeEmbedUrl`. */
    readonly embedUrl: string;
    readonly title: string;
}

/**
 * The trailer, as a 16:9 YouTube embed in a modal over the details column.
 * Escape and the backdrop close it; the title row keeps the single Close.
 */
@Component({
    selector: 'app-trailer-dialog',
    imports: [MatDialogModule, MatButtonModule, TranslatePipe],
    template: `
        <div class="trailer">
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
            <div class="trailer__bar">
                <h2 mat-dialog-title class="trailer__title">
                    {{ 'PORTALS.DETAIL.TRAILER_OF' | translate: { title: data.title } }}
                </h2>
                <button
                    mat-flat-button
                    type="button"
                    class="trailer__close"
                    mat-dialog-close
                    data-test-id="trailer-dialog-close"
                >
                    {{ 'CLOSE' | translate }}
                </button>
            </div>
        </div>
    `,
    styles: `
        :host {
            display: block;
        }

        .trailer {
            display: flex;
            flex-direction: column;
        }

        .trailer__frame {
            position: relative;
            width: 100%;
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

        .trailer__bar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
        }

        // Keeps the directive (the dialog's accessible name) but drops
        // Material's headline padding and the 40px strut before it.
        .trailer__title {
            flex: 1 1 auto;
            min-width: 0;
            margin: 0;
            padding: 0;
            overflow: hidden;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.3;
            text-overflow: ellipsis;
            white-space: nowrap;

            &::before {
                display: none;
            }
        }

        .trailer__close {
            flex: 0 0 auto;
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
