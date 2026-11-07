import { CommonModule } from '@angular/common';
import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { Language } from '@iptvnator/shared/interfaces';
import {
    StartupBehaviorOption,
    StartupWindowModeOption,
} from './settings.models';
import { markSectionForCheckOnFormEvents } from './settings-section-form-render';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';

@Component({
    selector: 'app-settings-general-section',
    providers: [provideFormFieldDefaults()],
    imports: [
        CommonModule,
        MatFormFieldModule,
        MatSelectModule,
        MatSlideToggleModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-general-section.component.html',
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
    readonly startupBehaviorOptions = input.required<StartupBehaviorOption[]>();
    readonly startupWindowModeOptions =
        input.required<StartupWindowModeOption[]>();
    /** Desktop only: the window-mode select needs the main-process mirror and F11 */
    readonly supportsStartupWindowMode = input(false);
    readonly supportsPortalConnectivityGuard = input(false);
}
