import { Component, input, output, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
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
    styles: [':host { display: contents; }'],
})
export class SettingsResetSectionComponent {
    readonly isRemovingAllPlaylists = input(false);
    readonly canRemoveAllPlaylists = input(false);
    readonly playlistDeleteSummary =
        input.required<SettingsPlaylistDeleteSummary>();
    readonly removeAllProgressLabel = input<string | null>(null);

    readonly removeAll = output<void>();
}
