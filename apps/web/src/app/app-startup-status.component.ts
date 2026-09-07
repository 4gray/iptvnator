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
