import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsEpgSectionComponent } from './settings-epg-section.component';
import { SETTINGS_EPG_VIEW_MODE_OPTIONS } from './settings-options';

function createForm(offset = 0): FormGroup {
    return new FormGroup({
        epgUrl: new FormArray<FormControl<string | null>>([]),
        epgViewMode: new FormControl('timeline'),
        epgOffsetMinutes: new FormControl<number>(offset, [
            Validators.required,
            Validators.min(-720),
            Validators.max(720),
        ]),
        preferUploadedEpgOverXtream: new FormControl(false),
    });
}

describe('SettingsEpgSectionComponent offset stepper', () => {
    let fixture: ComponentFixture<SettingsEpgSectionComponent>;

    function configure(form: FormGroup) {
        fixture.componentRef.setInput('form', form);
        fixture.componentRef.setInput('epgUrl', form.get('epgUrl'));
        fixture.componentRef.setInput(
            'epgViewModeOptions',
            SETTINGS_EPG_VIEW_MODE_OPTIONS
        );
        fixture.detectChanges();
        return form;
    }

    const query = (selector: string) =>
        (fixture.nativeElement as HTMLElement).querySelector(selector);

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SettingsEpgSectionComponent, TranslateModule.forRoot()],
        }).compileComponents();
        fixture = TestBed.createComponent(SettingsEpgSectionComponent);
    });

    it('moves the offset by one step and stages the change', () => {
        const form = configure(createForm(0));

        fixture.componentInstance.stepOffset(30);
        expect(form.get('epgOffsetMinutes')?.value).toBe(30);
        expect(form.get('epgOffsetMinutes')?.dirty).toBe(true);
        expect(form.dirty).toBe(true);

        fixture.componentInstance.stepOffset(-30);
        fixture.componentInstance.stepOffset(-30);
        expect(form.get('epgOffsetMinutes')?.value).toBe(-30);
    });

    it('clamps the buttons to the accepted range and recovers a bad value', () => {
        const form = configure(createForm(710));

        fixture.componentInstance.stepOffset(30);
        expect(form.get('epgOffsetMinutes')?.value).toBe(720);

        form.get('epgOffsetMinutes')?.setValue(Number.NaN);
        fixture.componentInstance.stepOffset(-30);
        expect(form.get('epgOffsetMinutes')?.value).toBe(-30);
    });

    it('shows the range error under the stepper for a typed value out of range', () => {
        const form = configure(createForm(0));

        expect(query('.settings-field-error')).toBeNull();

        form.get('epgOffsetMinutes')?.setValue(900);
        fixture.detectChanges();

        expect(query('.settings-stepper--invalid')).not.toBeNull();
        expect(query('.settings-field-error')).not.toBeNull();
    });

    it('offers Add in the empty state and in the header once a source exists', () => {
        const form = configure(createForm());
        const addButtons = () =>
            Array.from(
                (fixture.nativeElement as HTMLElement).querySelectorAll('button')
            ).filter((button) =>
                button.textContent?.includes('SETTINGS.ADD_EPG_SOURCE')
            );

        expect(query('[data-test-id="epg-sources-empty"]')).not.toBeNull();
        expect(addButtons()).toHaveLength(1);
        expect(query('.settings-section__actions')).toBeNull();

        (form.get('epgUrl') as FormArray).push(new FormControl('https://x'));
        fixture.detectChanges();

        expect(query('[data-test-id="epg-sources-empty"]')).toBeNull();
        expect(addButtons()).toHaveLength(1);
        expect(
            query('.settings-section__actions')?.contains(addButtons()[0])
        ).toBe(true);
        expect(query('.settings-section__count')?.textContent?.trim()).toBe(
            '1'
        );
    });
});
