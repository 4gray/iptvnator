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
    // eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection -- Preserve pre-Angular 22 eager checking during the framework upgrade.
    changeDetection: ChangeDetectionStrategy.Eager,
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
