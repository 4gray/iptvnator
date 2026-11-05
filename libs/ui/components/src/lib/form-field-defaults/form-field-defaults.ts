import { Provider } from '@angular/core';
import {
    MAT_FORM_FIELD_DEFAULT_OPTIONS,
    MatFormFieldDefaultOptions,
} from '@angular/material/form-field';

/** The app's outlined, dynamically sized form fields (see m3-theme.scss). */
export const APP_FORM_FIELD_DEFAULTS: MatFormFieldDefaultOptions = {
    appearance: 'outline',
    subscriptSizing: 'dynamic',
};

/**
 * Provide the app's form-field defaults on a component that renders
 * `<mat-form-field>`. They are not provided in the root injector: importing
 * the token there loads `@angular/material/form-field` (and, since Material
 * 22.2, `@angular/forms`) on startup, while every form field lives in a lazy
 * chunk. `tools/nx/check-form-field-defaults.mjs` enforces this.
 */
export function provideFormFieldDefaults(): Provider {
    return {
        provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
        useValue: APP_FORM_FIELD_DEFAULTS,
    };
}
