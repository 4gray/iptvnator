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

describe('settings form utils — EPG display offset', () => {
    const formBuilder = new FormBuilder();

    it('defaults the form control to zero and only exists when EPG is supported', () => {
        expect(
            createSettingsForm(formBuilder, true).getRawValue().epgOffsetMinutes
        ).toBe(0);
        expect(
            'epgOffsetMinutes' in
                createSettingsForm(formBuilder, false).controls
        ).toBe(false);
    });

    it('carries a whole-minute offset into the settings object', () => {
        const form = createSettingsForm(formBuilder, true);
        form.patchValue({ epgOffsetMinutes: -90 });

        expect(form.valid).toBe(true);
        expect(
            createSettingsFromFormValue(form, {} as Settings).epgOffsetMinutes
        ).toBe(-90);
    });

    it('rejects blanks, fractions and out-of-range values in the form', () => {
        const form = createSettingsForm(formBuilder, true);
        const control = form.get('epgOffsetMinutes');

        control?.setValue(null);
        expect(control?.valid).toBe(false);
        control?.setValue(15.5);
        expect(control?.valid).toBe(false);
        control?.setValue(721);
        expect(control?.valid).toBe(false);
        control?.setValue(-720);
        expect(control?.valid).toBe(true);
    });

    it('keeps the stored offset when EPG is unsupported and the control is absent', () => {
        const form = createSettingsForm(formBuilder, false);

        expect(
            createSettingsFromFormValue(form, {
                epgOffsetMinutes: 45,
            } as Settings).epgOffsetMinutes
        ).toBe(45);
    });
});
