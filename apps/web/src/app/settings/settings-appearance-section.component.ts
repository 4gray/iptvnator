import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    ViewEncapsulation,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { CoverSize, Theme } from '@iptvnator/shared/interfaces';
import {
    RadioGroupDirective,
    RadioOptionDirective,
} from '@iptvnator/ui/components/radio-group';
import { CoverSizeOption, ThemeOption } from './settings.models';
import { markSectionForCheckOnFormEvents } from './settings-section-form-render';

@Component({
    selector: 'app-settings-appearance-section',
    imports: [
        ReactiveFormsModule,
        MatIconModule,
        MatSlideToggleModule,
        TranslateModule,
        RadioGroupDirective,
        RadioOptionDirective,
    ],
    templateUrl: './settings-appearance-section.component.html',
    styleUrls: ['./_theme-picker.scss'],
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { style: 'display: contents' },
})
export class SettingsAppearanceSectionComponent {
    readonly form = input.required<FormGroup>();
    readonly themeOptions = input.required<ThemeOption[]>();
    readonly coverSizeOptions = input.required<CoverSizeOption[]>();
    readonly selectTheme = output<Theme>();
    readonly selectCoverSize = output<CoverSize>();

    constructor() {
        markSectionForCheckOnFormEvents(this.form);
    }
}
