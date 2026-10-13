import { Directive, NgModule } from '@angular/core';
import {
    MAT_FORM_FIELD_DEFAULT_OPTIONS,
    MatFormFieldDefaultOptions,
    MatFormFieldModule,
} from '@angular/material/form-field';

/** The app-wide form field: outlined, with hints and errors sized as needed. */
export const APP_FORM_FIELD_DEFAULTS: MatFormFieldDefaultOptions = {
    appearance: 'outline',
    subscriptSizing: 'dynamic',
};

/**
 * Gives every `<mat-form-field>` the app defaults through its own element
 * injector, which `MatFormField` reads before any environment injector.
 *
 * Provided at the root, the defaults were a static import of
 * `@angular/material/form-field` in `app.config.ts`, and one eager import of
 * any export puts a module's whole bundler chunk on the initial path: 54 KB
 * of form-field code for an app whose every form field renders in a lazy
 * route or dialog. A route-level provider would miss the dialogs that root
 * services open, so the defaults travel with the element instead.
 */
@Directive({
    // The directive must match the Material element itself: an attribute
    // would have to be added to every form field by hand.
    // eslint-disable-next-line @angular-eslint/directive-selector
    selector: 'mat-form-field',
    providers: [
        {
            provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
            useValue: APP_FORM_FIELD_DEFAULTS,
        },
    ],
})
export class AppFormFieldDefaultsDirective {}

/**
 * Import this, not `MatFormFieldModule`, wherever a template renders
 * `<mat-form-field>`; it exports Material's form field together with the
 * defaults directive. `pnpm run styles:form-field-defaults:validate` (CI)
 * rejects a component that renders a form field without it.
 */
@NgModule({
    imports: [MatFormFieldModule, AppFormFieldDefaultsDirective],
    exports: [MatFormFieldModule, AppFormFieldDefaultsDirective],
})
export class AppFormFieldModule {}
