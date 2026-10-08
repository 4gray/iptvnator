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

@Component({
    selector: 'app-settings-reset-section',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        TranslateModule,
    ],
    templateUrl: './settings-reset-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
})
export class SettingsResetSectionComponent {
    readonly sourceIcons = SOURCE_TYPE_ICONS;
    readonly isRemovingAllPlaylists = input(false);
    readonly canRemoveAllPlaylists = input(false);
    readonly playlistDeleteSummary =
        input.required<SettingsPlaylistDeleteSummary>();
    readonly removeAllProgressLabel = input<string | null>(null);

    readonly removeAll = output<void>();
}
