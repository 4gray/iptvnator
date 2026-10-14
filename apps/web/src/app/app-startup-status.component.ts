import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
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
    imports: [MatButtonModule, TranslatePipe],
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
                    <div class="startup-spinner" aria-hidden="true">
                        <div class="startup-spinner__container">
                            <div class="startup-spinner__layer">
                                <div
                                    class="startup-spinner__clipper startup-spinner__clipper--left"
                                >
                                    <svg
                                        viewBox="0 0 25.2 25.2"
                                        focusable="false"
                                    >
                                        <circle r="11" cx="50%" cy="50%" />
                                    </svg>
                                </div>
                                <div class="startup-spinner__gap">
                                    <svg
                                        viewBox="0 0 25.2 25.2"
                                        focusable="false"
                                    >
                                        <circle r="11" cx="50%" cy="50%" />
                                    </svg>
                                </div>
                                <div
                                    class="startup-spinner__clipper startup-spinner__clipper--right"
                                >
                                    <svg
                                        viewBox="0 0 25.2 25.2"
                                        focusable="false"
                                    >
                                        <circle r="11" cx="50%" cy="50%" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>
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

        /*
         * The same drawing as an indeterminate <mat-spinner diameter="32">
         * (two clipped half circles plus a gap patch, Material's durations,
         * curves and keyframes, a 10% stroke on a 25.2 viewBox around an
         * r=11 circle, 1.25x slower under reduced motion), as static markup:
         * the component would load the progress-spinner chunk before the
         * app's first screen and set every attribute after insertion.
         */
        .startup-spinner {
            --startup-spinner-multiplier: 1;
            position: relative;
            width: 32px;
            height: 32px;
            overflow: hidden;
            line-height: 0;
            direction: ltr;
        }
        @media (prefers-reduced-motion: reduce) {
            .startup-spinner {
                --startup-spinner-multiplier: 1.25;
            }
        }
        .startup-spinner__container,
        .startup-spinner__layer,
        .startup-spinner svg {
            position: absolute;
            width: 100%;
            height: 100%;
        }
        .startup-spinner__container {
            animation: startup-spinner-container-rotate
                calc(1568.2352941176ms * var(--startup-spinner-multiplier))
                linear infinite;
        }
        .startup-spinner__layer {
            animation: startup-spinner-layer-rotate
                calc(5332ms * var(--startup-spinner-multiplier))
                cubic-bezier(0.4, 0, 0.2, 1) infinite both;
        }
        .startup-spinner__clipper {
            display: inline-flex;
            position: relative;
            width: 50%;
            height: 100%;
            overflow: hidden;
        }
        .startup-spinner__clipper svg {
            width: 200%;
        }
        .startup-spinner__clipper--left svg {
            animation: startup-spinner-left-spin
                calc(1333ms * var(--startup-spinner-multiplier))
                cubic-bezier(0.4, 0, 0.2, 1) infinite both;
        }
        .startup-spinner__clipper--right svg {
            left: -100%;
            animation: startup-spinner-right-spin
                calc(1333ms * var(--startup-spinner-multiplier))
                cubic-bezier(0.4, 0, 0.2, 1) infinite both;
        }
        .startup-spinner__gap {
            position: absolute;
            top: 0;
            left: 47.5%;
            box-sizing: border-box;
            width: 5%;
            height: 100%;
            overflow: hidden;
        }
        .startup-spinner__gap svg {
            left: -900%;
            width: 2000%;
            transform: rotate(180deg);
        }
        .startup-spinner svg {
            fill: transparent;
        }
        .startup-spinner circle {
            stroke: var(--mat-sys-primary);
            stroke-width: 10%;
            stroke-dasharray: 69.11503837897544px;
            stroke-dashoffset: 34.55751918948772px;
        }
        @media (forced-colors: active) {
            .startup-spinner circle {
                stroke: CanvasText;
            }
        }
        @keyframes startup-spinner-container-rotate {
            to {
                transform: rotate(360deg);
            }
        }
        @keyframes startup-spinner-layer-rotate {
            12.5% {
                transform: rotate(135deg);
            }
            25% {
                transform: rotate(270deg);
            }
            37.5% {
                transform: rotate(405deg);
            }
            50% {
                transform: rotate(540deg);
            }
            62.5% {
                transform: rotate(675deg);
            }
            75% {
                transform: rotate(810deg);
            }
            87.5% {
                transform: rotate(945deg);
            }
            100% {
                transform: rotate(1080deg);
            }
        }
        @keyframes startup-spinner-left-spin {
            from {
                transform: rotate(265deg);
            }
            50% {
                transform: rotate(130deg);
            }
            to {
                transform: rotate(265deg);
            }
        }
        @keyframes startup-spinner-right-spin {
            from {
                transform: rotate(-265deg);
            }
            50% {
                transform: rotate(-130deg);
            }
            to {
                transform: rotate(-265deg);
            }
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
