import {
    Component,
    computed,
    inject,
    OnInit,
    SecurityContext,
    signal,
    ViewEncapsulation,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { marked } from 'marked';
import {
    ElectronBridgeAppUpdateReleaseNotes,
    ElectronBridgeAppUpdateReleaseNotesDirection,
    ElectronBridgeAppUpdateReleaseNotesRequest,
} from '@iptvnator/shared/interfaces';

const RELEASE_NOTES_IMAGE_CLASS = 'release-notes-dialog__image';

export interface AppUpdateReleaseNotesDialogData {
    initialVersion?: string;
    fallbackToLatest?: boolean;
}

function decorateReleaseNotesHtml(html: string): string {
    if (typeof document === 'undefined') {
        return html;
    }

    const template = document.createElement('template');
    template.innerHTML = html;

    template.content.querySelectorAll('img').forEach((image) => {
        image.classList.add(RELEASE_NOTES_IMAGE_CLASS);
    });

    return template.innerHTML;
}

@Component({
    selector: 'app-update-release-notes-dialog',
    imports: [
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        MatProgressSpinnerModule,
        DatePipe,
        TranslatePipe,
    ],
    encapsulation: ViewEncapsulation.None,
    template: `
        <h2 mat-dialog-title>
            {{ 'SETTINGS.APP_UPDATE_RELEASE_NOTES' | translate }}
        </h2>

        <mat-dialog-content class="release-notes-dialog mat-typography">
            <div class="release-notes-dialog__toolbar">
                <button
                    mat-icon-button
                    type="button"
                    [disabled]="loading() || !notes()?.hasPrevious"
                    (click)="load('previous')"
                    data-test-id="release-notes-previous"
                >
                    <mat-icon>chevron_left</mat-icon>
                </button>

                <div class="release-notes-dialog__version">
                    <strong>{{ notes()?.releaseName || notes()?.tagName }}</strong>
                    @if (notes()?.publishedAt; as publishedAt) {
                        <span>{{ publishedAt | date: 'mediumDate' }}</span>
                    }
                </div>

                <button
                    mat-icon-button
                    type="button"
                    [disabled]="loading() || !notes()?.hasNext"
                    (click)="load('next')"
                    data-test-id="release-notes-next"
                >
                    <mat-icon>chevron_right</mat-icon>
                </button>
            </div>

            @if (loading()) {
                <div class="release-notes-dialog__loading">
                    <mat-spinner diameter="28" />
                </div>
            } @else if (error()) {
                <p class="release-notes-dialog__error">{{ error() }}</p>
            } @else {
                <article
                    class="release-notes-dialog__body"
                    data-test-id="release-notes-body"
                    [innerHTML]="renderedMarkdown()"
                ></article>
            }
        </mat-dialog-content>

        <mat-dialog-actions align="end">
            @if (notes()?.htmlUrl; as htmlUrl) {
                <button mat-button type="button" (click)="openRelease(htmlUrl)">
                    <mat-icon>open_in_new</mat-icon>
                    {{ 'SETTINGS.APP_UPDATE_OPEN_RELEASE' | translate }}
                </button>
            }
            <button mat-flat-button type="button" (click)="close()">
                {{ 'CLOSE' | translate }}
            </button>
        </mat-dialog-actions>
    `,
    styles: [
        `
            .release-notes-dialog {
                min-width: min(640px, calc(100vw - 64px));
                max-width: min(760px, calc(100vw - 32px));
            }

            .release-notes-dialog__toolbar {
                display: grid;
                grid-template-columns: 40px minmax(0, 1fr) 40px;
                align-items: center;
                gap: 8px;
                padding: 4px 0 12px;
                border-bottom: 1px solid var(--app-separator);
            }

            .release-notes-dialog__version {
                min-width: 0;
                text-align: center;
            }

            .release-notes-dialog__version strong,
            .release-notes-dialog__version span {
                display: block;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .release-notes-dialog__version span {
                margin-top: 2px;
                color: var(--app-muted-color);
                font-size: 0.78rem;
            }

            .release-notes-dialog__loading {
                display: flex;
                justify-content: center;
                padding: 32px;
            }

            .release-notes-dialog__error {
                color: var(--app-error-color, #ef4444);
            }

            .release-notes-dialog__body {
                max-height: min(58vh, 560px);
                overflow: auto;
                padding: 12px 2px 0;
                color: var(--app-body-color);
            }

            .release-notes-dialog__body h1,
            .release-notes-dialog__body h2,
            .release-notes-dialog__body h3 {
                color: var(--app-heading-color);
                letter-spacing: 0;
            }

            .release-notes-dialog__body h1 {
                font-size: 1.3rem;
            }

            .release-notes-dialog__body h2 {
                font-size: 1.1rem;
            }

            .release-notes-dialog__body h3 {
                font-size: 1rem;
            }

            .release-notes-dialog__body code {
                border-radius: 4px;
                padding: 1px 4px;
                background: var(--app-hover-overlay);
            }

            .release-notes-dialog__body img,
            .release-notes-dialog__image {
                display: block;
                box-sizing: border-box;
                max-width: 100%;
                height: auto;
                margin: 16px auto;
                object-fit: contain;
            }
        `,
    ],
})
export class AppUpdateReleaseNotesDialogComponent implements OnInit {
    private readonly data = inject<AppUpdateReleaseNotesDialogData>(
        MAT_DIALOG_DATA
    );
    private readonly dialogRef = inject(
        MatDialogRef<AppUpdateReleaseNotesDialogComponent>
    );
    private readonly sanitizer = inject(DomSanitizer);

    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly notes = signal<ElectronBridgeAppUpdateReleaseNotes | null>(null);
    readonly renderedMarkdown = computed(() => {
        const markdown = this.notes()?.bodyMarkdown ?? '';
        const html = marked.parse(markdown, { async: false }) as string;
        const sanitizedHtml =
            this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';

        return decorateReleaseNotesHtml(sanitizedHtml);
    });

    ngOnInit(): void {
        void this.load();
    }

    async load(
        direction?: ElectronBridgeAppUpdateReleaseNotesDirection
    ): Promise<void> {
        if (!window.electron?.getAppUpdateReleaseNotes) {
            this.error.set('Release notes are not available in this build.');
            return;
        }

        const version = direction
            ? this.notes()?.tagName
            : this.data.initialVersion;
        const fallbackToLatest = direction
            ? undefined
            : this.data.fallbackToLatest;

        this.loading.set(true);
        this.error.set(null);

        try {
            const request: ElectronBridgeAppUpdateReleaseNotesRequest = {};

            if (direction) {
                request.direction = direction;
            }

            if (version) {
                request.version = version;
            }

            if (fallbackToLatest) {
                request.fallbackToLatest = true;
            }

            this.notes.set(
                await window.electron.getAppUpdateReleaseNotes(request)
            );
        } catch (error) {
            this.error.set(error instanceof Error ? error.message : String(error));
        } finally {
            this.loading.set(false);
        }
    }

    openRelease(url: string): void {
        window.open(url, '_blank', 'noreferrer');
    }

    close(): void {
        this.dialogRef.close();
    }
}
