import {
    Component,
    input,
    output,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { SOURCE_TYPE_ICONS } from '@iptvnator/shared/interfaces';
import { SettingsPlaylistDeleteSummary } from './settings.models';

/**
 * Backup & data: import/export plus the one destructive reset action, which
 * used to be a page of its own.
 */
@Component({
    selector: 'app-settings-backup-section',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        TranslateModule,
    ],
    templateUrl: './settings-backup-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ['./settings-backup-section.component.scss'],
})
export class SettingsBackupSectionComponent {
    readonly sourceIcons = SOURCE_TYPE_ICONS;
    readonly isPwa = input(false);
    readonly isRemovingAllPlaylists = input(false);
    readonly isExportingData = input(false);
    readonly canRemoveAllPlaylists = input(false);
    readonly playlistDeleteSummary =
        input.required<SettingsPlaylistDeleteSummary>();
    readonly removeAllProgressLabel = input<string | null>(null);

    readonly importData = output<void>();
    readonly exportData = output<void>();
    readonly removeAll = output<void>();
}
