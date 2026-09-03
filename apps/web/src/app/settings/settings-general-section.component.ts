import { CommonModule } from '@angular/common';
import { Component, input, output, ViewEncapsulation } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule } from '@ngx-translate/core';
import { CoverSize, Language, Theme } from '@iptvnator/shared/interfaces';
import {
    CoverSizeOption,
    StartupBehaviorOption,
    StartupWindowModeOption,
    ThemeOption,
} from './settings.models';

@Component({
    selector: 'app-settings-general-section',
    imports: [
        CommonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatIconModule,
        MatSelectModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-general-section.component.html',
    encapsulation: ViewEncapsulation.None,
    styles: [':host { display: contents; }'],
})
export class SettingsGeneralSectionComponent {
    readonly form = input.required<FormGroup>();
    readonly languageEnum = input.required<typeof Language>();
    readonly themeOptions = input.required<ThemeOption[]>();
    readonly coverSizeOptions = input.required<CoverSizeOption[]>();
    readonly startupBehaviorOptions = input.required<StartupBehaviorOption[]>();
    readonly startupWindowModeOptions =
        input.required<StartupWindowModeOption[]>();
    /** Desktop only: the window-mode select needs the main-process mirror and F11 */
    readonly supportsStartupWindowMode = input(false);

    readonly selectTheme = output<Theme>();
    readonly selectCoverSize = output<CoverSize>();
}
