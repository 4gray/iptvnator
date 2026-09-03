import { FormBuilder } from '@angular/forms';
import { Settings } from '@iptvnator/shared/interfaces';
import {
    createSettingsForm,
    createSettingsFromFormValue,
} from './settings-form.utils';

describe('settings form utils — strip country prefix', () => {
    const formBuilder = new FormBuilder();

    it('defaults the form control to false', () => {
        const form = createSettingsForm(formBuilder, true);

        expect(form.getRawValue().stripCountryPrefix).toBe(false);
    });

    it('carries an enabled toggle into the settings object', () => {
        const form = createSettingsForm(formBuilder, true);
        form.patchValue({ stripCountryPrefix: true });

        const settings = createSettingsFromFormValue(form, {} as Settings);

        expect(settings.stripCountryPrefix).toBe(true);
    });

    it('falls back to false when the form value is missing', () => {
        const form = createSettingsForm(formBuilder, true);
        form.patchValue({
            stripCountryPrefix: null as unknown as boolean,
        });

        const settings = createSettingsFromFormValue(form, {} as Settings);

        expect(settings.stripCountryPrefix).toBe(false);
    });
});

describe('settings form utils — startup window mode', () => {
    const formBuilder = new FormBuilder();

    it('defaults the form control to a normal window', () => {
        const form = createSettingsForm(formBuilder, true);

        expect(form.getRawValue().startupWindowMode).toBe('normal');
    });

    it('carries the chosen mode into the settings object', () => {
        const form = createSettingsForm(formBuilder, true);
        form.patchValue({ startupWindowMode: 'fullscreen' });

        const settings = createSettingsFromFormValue(form, {} as Settings);

        expect(settings.startupWindowMode).toBe('fullscreen');
    });

    it('collapses a missing or unknown form value to normal', () => {
        const form = createSettingsForm(formBuilder, true);
        form.patchValue({
            startupWindowMode: null as unknown as 'normal',
        });
        expect(
            createSettingsFromFormValue(form, {} as Settings).startupWindowMode
        ).toBe('normal');

        form.patchValue({
            startupWindowMode: 'kiosk' as unknown as 'normal',
        });
        expect(
            createSettingsFromFormValue(form, {} as Settings).startupWindowMode
        ).toBe('normal');
    });
});
