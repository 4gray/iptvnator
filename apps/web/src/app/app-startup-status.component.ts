import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    PlaylistActions,
    selectPlaylistsLoadFailed,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';

/** The first route also waits for settings and XMLTV source reconciliation. */
@Component({
    selector: 'app-startup-status',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatProgressSpinnerModule, TranslatePipe],
    template: `
        @if (!complete()) {
            <section
                [attr.role]="failed() ? 'alert' : 'status'"
                aria-live="polite"
            >
                <svg
                    class="startup-watermark"
                    viewBox="0 0 256 256"
                    aria-hidden="true"
                    focusable="false"
                >
                    <g fill="none" stroke="currentColor" stroke-width="5">
                        <rect x="46" y="53" width="166" height="115" rx="2" />
                        <path d="M128 168v32M67 200h122" />
                        <path
                            d="M94 101Q129 72 165 101M101 109Q129 85 158 109M108 117Q129 99 151 117"
                        />
                    </g>
                    <path
                        d="M119 126Q129 120 139 126L129 138Z"
                        fill="currentColor"
                    />
                </svg>
                @if (!failed()) {
                    <mat-spinner diameter="32" aria-hidden="true" />
                }
                <h1>
                    {{
                        (failed() ? 'STARTUP.FAILED' : 'STARTUP.PREPARING')
                            | translate
                    }}
                </h1>
                <p>
                    {{
                        (failed()
                            ? 'STARTUP.FAILED_DETAIL'
                            : 'STARTUP.PREPARING_DETAIL'
                        ) | translate
                    }}
                </p>
                @if (failed()) {
                    <button mat-flat-button type="button" (click)="retry()">
                        {{ 'RETRY' | translate }}
                    </button>
                }
            </section>
        }
    `,
    styles: `
        :host {
            display: contents;
        }
        section {
            app-region: drag;
            position: relative;
            isolation: isolate;
            overflow: clip;
            min-height: 100dvh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 48px 24px;
            box-sizing: border-box;
            background: var(--app-content-bg);
            color: var(--app-heading-color);
            text-align: center;
        }
        .startup-watermark {
            position: absolute;
            right: -14%;
            bottom: -34%;
            width: clamp(420px, 76vw, 960px);
            height: auto;
            opacity: 0.07;
            transform: rotate(-14deg);
            mask-image: linear-gradient(135deg, transparent 15%, #000 78%);
            pointer-events: none;
            z-index: 0;
        }
        section > :not(svg) {
            position: relative;
            z-index: 1;
        }
        h1 {
            margin: 0;
            font-size: 18px;
            font-weight: 500;
        }
        p {
            margin: 0;
            max-width: 420px;
            color: var(--app-body-color);
            line-height: 1.5;
        }
        button {
            margin-top: 8px;
            app-region: no-drag;
        }
    `,
})
export class AppStartupStatusComponent {
    private readonly store = inject(Store);
    readonly routeReady = input(false);
    private readonly sourcesReady = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );
    readonly failed = this.store.selectSignal(selectPlaylistsLoadFailed);
    readonly complete = computed(
        () => this.routeReady() && this.sourcesReady()
    );

    retry(): void {
        this.store.dispatch(PlaylistActions.loadPlaylists());
    }
}
