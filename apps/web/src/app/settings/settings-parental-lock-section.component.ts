import { Component, input, output, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { ParentalLockRelockMinutes } from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-settings-parental-lock-section',
    imports: [
        MatButtonModule,
        MatFormFieldModule,
        MatIconModule,
        MatSelectModule,
        MatSlideToggleModule,
        TranslateModule,
    ],
    templateUrl: './settings-parental-lock-section.component.html',
    encapsulation: ViewEncapsulation.None,
    styles: [':host { display: contents; }'],
})
export class SettingsParentalLockSectionComponent {
    readonly enabled = input.required<boolean>();
    readonly unlocked = input.required<boolean>();
    readonly hasPin = input.required<boolean>();
    readonly relockMinutes = input.required<ParentalLockRelockMinutes>();
    readonly relockOptions =
        input.required<readonly ParentalLockRelockMinutes[]>();
    readonly busy = input(false);

    readonly toggleEnabled = output<boolean>();
    readonly changePin = output<void>();
    readonly relockMinutesChanged = output<ParentalLockRelockMinutes>();
    readonly lockNow = output<void>();
    readonly unlock = output<void>();

    relockLabelKey(minutes: ParentalLockRelockMinutes): string {
        return minutes === 0
            ? 'SETTINGS.PARENTAL_LOCK.RELOCK_NEVER'
            : 'SETTINGS.PARENTAL_LOCK.RELOCK_MINUTES';
    }
}
