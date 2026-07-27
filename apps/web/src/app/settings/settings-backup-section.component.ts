import {
    Component,
    inject,
    input,
    output,
    ViewEncapsulation,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsBackupFacade } from './settings-backup.facade';

@Component({
    selector: 'app-settings-backup-section',
    imports: [
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        MatProgressSpinnerModule,
        TranslateModule,
    ],
    templateUrl: './settings-backup-section.component.html',
    encapsulation: ViewEncapsulation.None,
    styles: [
        `
            :host {
                display: contents;
            }

            .settings-backup-warning--secrets {
                color: var(--mat-sys-error);
                font-weight: 600;
            }
        `,
    ],
})
export class SettingsBackupSectionComponent {
    private readonly backupFacade = inject(SettingsBackupFacade);

    readonly activeSection = input.required<string>();
    readonly isPwa = input(false);
    readonly isRemovingAllPlaylists = input(false);
    readonly isExportingData = input(false);
    readonly includeSecrets = this.backupFacade.includeSecrets;

    readonly importData = output<void>();
    readonly exportData = output<void>();
}
