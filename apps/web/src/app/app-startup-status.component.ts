import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppStartupRecoveryComponent } from './app-startup-recovery.component';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { filter, map } from 'rxjs';
import {
    PlaylistActions,
    selectPlaylistsLoadFailed,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { SERVER_SIGN_IN_PATH } from '@iptvnator/services';

/** The first route also waits for settings and XMLTV source reconciliation. */
@Component({
    selector: 'app-startup-status',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AppStartupRecoveryComponent, NgTemplateOutlet, TranslatePipe],
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
                    <!--
                        Material's button loads with the failure branch so the
                        first screen does not carry the button chunk. A native
                        button retries while the chunk downloads and stays when
                        the load fails.
                    -->
                    @defer (on immediate) {
                        <app-startup-recovery />
                    } @placeholder {
                        <ng-container [ngTemplateOutlet]="nativeRetry" />
                    } @error {
                        <ng-container [ngTemplateOutlet]="nativeRetry" />
                    }
                    <ng-template #nativeRetry>
                        <button
                            class="startup-button"
                            type="button"
                            (click)="retry()"
                        >
                            {{ 'RETRY' | translate }}
                        </button>
                        <button
                            type="button"
                            class="startup-button startup-secondary"
                            data-test-id="startup-open-settings"
                            (click)="openSettings()"
                        >
                            {{ 'WORKSPACE.SHELL.OPEN_SETTINGS' | translate }}
                        </button>
                    </ng-template>
                }
            </section>
        }
    `,
    styleUrl: './app-startup-status.component.scss',
})
export class AppStartupStatusComponent {
    private readonly store = inject(Store);
    readonly routeReady = input(false);
    private readonly sourcesReady = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );
    readonly failed = this.store.selectSignal(selectPlaylistsLoadFailed);
    private readonly router = inject(Router);
    openSettings(): void {
        void this.router.navigateByUrl('/workspace/settings');
    }
    private readonly url = toSignal(
        this.router.events.pipe(
            filter((event) => event instanceof NavigationEnd),
            map((event) => event.urlAfterRedirects)
        ),
        { initialValue: this.router.url }
    );
    /**
     * Sign-in and all settings remain reachable while the source inventory
     * is pending or failed, so recovery never depends on a provider download.
     */
    private readonly onRecoveryPage = computed(
        () =>
            this.url().startsWith(SERVER_SIGN_IN_PATH) ||
            this.url().split(/[?#]/)[0] === '/workspace/settings' ||
            this.url().startsWith('/workspace/settings/')
    );
    readonly complete = computed(
        () =>
            this.routeReady() && (this.sourcesReady() || this.onRecoveryPage())
    );

    retry(): void {
        this.store.dispatch(PlaylistActions.loadPlaylists());
    }
}
