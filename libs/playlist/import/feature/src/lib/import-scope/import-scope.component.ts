import {
    Component,
    ChangeDetectionStrategy,
    computed,
    inject,
    model,
} from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslatePipe } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';

/**
 * Live-channels vs VOD (movies + series) import toggles shared by every
 * single-source form. A source that imports nothing is broken, so the last
 * checked box disables instead of clearing — a vetoed uncheck would leave
 * the natively toggled checkbox visually off while the state stays on
 * (Angular skips same-value binding writes).
 *
 * While the global Disable VOD setting is on the boxes show what will be
 * imported (live only) and stay locked; the models keep the source's own
 * choice, so turning the setting off brings its VOD back.
 */
@Component({
    imports: [MatCheckboxModule, TranslatePipe],
    selector: 'app-import-scope',
    template: `
        <div class="import-scope">
            <p class="import-scope__label">
                {{ 'HOME.ADD_PLAYLIST.IMPORT_SCOPE_LABEL' | translate }}
            </p>
            <mat-checkbox
                [checked]="importLive() || vodDisabled()"
                [disabled]="!importVod() || vodDisabled()"
                (change)="importLive.set($event.checked)"
            >
                {{ 'HOME.ADD_PLAYLIST.IMPORT_SCOPE_LIVE' | translate }}
            </mat-checkbox>
            <mat-checkbox
                [checked]="importVod() && !vodDisabled()"
                [disabled]="!importLive() || vodDisabled()"
                (change)="importVod.set($event.checked)"
            >
                {{ 'HOME.ADD_PLAYLIST.IMPORT_SCOPE_VOD' | translate }}
            </mat-checkbox>
            @if (vodDisabled()) {
                <p class="import-scope__hint">
                    {{
                        'HOME.ADD_PLAYLIST.IMPORT_SCOPE_VOD_DISABLED'
                            | translate
                    }}
                </p>
            }
        </div>
    `,
    styles: [
        `
            .import-scope {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin: 4px 0 12px;
            }

            .import-scope__label,
            .import-scope__hint {
                margin: 0;
                color: var(--mat-sys-on-surface-variant);
                font-size: 12px;
            }
        `,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportScopeComponent {
    readonly importLive = model(true);
    readonly importVod = model(true);
    private readonly settingsStore = inject(SettingsStore);
    readonly vodDisabled = computed(
        () => this.settingsStore.disableVod?.() === true
    );
}
