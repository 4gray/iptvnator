import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
    ViewEncapsulation,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { CoverSize, Theme, ThemeAccent } from '@iptvnator/shared/interfaces';
import {
    RadioGroupDirective,
    RadioOptionDirective,
} from '@iptvnator/ui/components/radio-group';
import { map, startWith, switchMap } from 'rxjs';
import { SettingsService } from '../services/settings.service';
import { SETTINGS_THEME_ACCENT_OPTIONS } from './settings-options';
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
    readonly selectThemeAccent = output<ThemeAccent | null>();
    readonly selectCoverSize = output<CoverSize>();

    private readonly settingsService = inject(SettingsService);
    readonly appliedThemePresetId = this.settingsService.appliedThemePresetId;

    private readonly selectedAccent = toSignal(
        toObservable(this.form).pipe(
            switchMap((form) =>
                form.valueChanges.pipe(startWith(form.value))
            ),
            map((value) => (value?.themeAccent ?? null) as ThemeAccent | null)
        ),
        { initialValue: null }
    );

    /**
     * Each swatch in the colour the accent takes on the theme on screen, so
     * the row previews what selecting it does (darker on light themes).
     */
    readonly accentSwatches = computed(() => {
        this.appliedThemePresetId();
        const selected = this.selectedAccent();
        return SETTINGS_THEME_ACCENT_OPTIONS.map((option) => ({
            ...option,
            id: option.value ?? 'theme',
            selected: option.value === selected,
            color: option.value
                ? this.settingsService.previewThemeAccentColor(option.value)
                : null,
        }));
    });

    readonly selectedAccentLabelKey = computed(
        () =>
            this.accentSwatches().find((swatch) => swatch.selected)
                ?.labelKey ?? ''
    );

    constructor() {
        markSectionForCheckOnFormEvents(this.form);
    }
}
