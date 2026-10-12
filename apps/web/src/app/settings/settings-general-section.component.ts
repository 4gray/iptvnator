import { CommonModule } from '@angular/common';
import {
    Component,
    input,
    output,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { CoverSize, Language, Theme } from '@iptvnator/shared/interfaces';
import {
    CoverSizeOption,
    StartupBehaviorOption,
    StartupWindowModeOption,
    ThemeOption,
} from './settings.models';
import { markSectionForCheckOnFormEvents } from './settings-section-form-render';

@Component({
    selector: 'app-settings-general-section',
    imports: [
        CommonModule,
        MatFormFieldModule,
        MatIconModule,
        MatSelectModule,
        MatSlideToggleModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-general-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
})
export class SettingsGeneralSectionComponent {
    readonly form = input.required<FormGroup>();

    constructor() {
        // Parent patches (Discard, backup import) change the form outside
        // this OnPush section's events.
        markSectionForCheckOnFormEvents(this.form);
    }

    readonly languageEnum = input.required<typeof Language>();
    readonly themeOptions = input.required<ThemeOption[]>();
    readonly coverSizeOptions = input.required<CoverSizeOption[]>();
    readonly startupBehaviorOptions = input.required<StartupBehaviorOption[]>();
    readonly startupWindowModeOptions =
        input.required<StartupWindowModeOption[]>();
    /** Desktop only: the window-mode select needs the main-process mirror and F11 */
    readonly supportsStartupWindowMode = input(false);
    readonly supportsPortalConnectivityGuard = input(false);

    readonly selectTheme = output<Theme>();
    readonly selectCoverSize = output<CoverSize>();
}
