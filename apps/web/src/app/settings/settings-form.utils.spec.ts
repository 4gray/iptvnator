import { FormBuilder } from '@angular/forms';
import { Settings } from '@iptvnator/shared/interfaces';
import {
    createSettingsForm,
    createSettingsFromFormValue,
} from './settings-form.utils';

describe('settings form local timeshift controls', () => {
    const formBuilder = new FormBuilder();

    it('uses the disabled 30-minute system-cache defaults', () => {
        const form = createSettingsForm(formBuilder, false);

        expect(form.get('localTimeshift')?.getRawValue()).toEqual({
            enabled: false,
            maxDurationMinutes: 30,
            bufferDirectory: '',
        });
    });

    it.each([
        { value: null, error: 'required' },
        { value: 4, error: 'min' },
        { value: 181, error: 'max' },
        { value: 30.5, error: 'pattern' },
    ])('rejects invalid duration $value with $error', ({ value, error }) => {
        const form = createSettingsForm(formBuilder, false);
        const duration = form.get('localTimeshift.maxDurationMinutes');

        duration?.setValue(value);

        expect(duration?.hasError(error)).toBe(true);
        expect(form.invalid).toBe(true);
    });

    it.each([5, 30, 180])('accepts duration %s', (value) => {
        const form = createSettingsForm(formBuilder, false);
        const duration = form.get('localTimeshift.maxDurationMinutes');

        duration?.setValue(value);

        expect(duration?.valid).toBe(true);
    });

    it('serializes a normalized local timeshift configuration', () => {
        const form = createSettingsForm(formBuilder, false);
        form.patchValue({
            localTimeshift: {
                enabled: true,
                maxDurationMinutes: 75,
                bufferDirectory: '  /tmp/iptvnator-timeshift  ',
            },
        });

        const settings = createSettingsFromFormValue(form, {} as Settings);

        expect(settings.localTimeshift).toEqual({
            enabled: true,
            maxDurationMinutes: 75,
            bufferDirectory: '/tmp/iptvnator-timeshift',
        });
    });
});

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
