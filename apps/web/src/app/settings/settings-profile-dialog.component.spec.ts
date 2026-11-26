import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
    SettingsProfileDialogComponent,
    type SettingsProfileDialogData,
} from './settings-profile-dialog.component';

function setup(submit: SettingsProfileDialogData['submit']) {
    const close = jest.fn();
    const ref = { close, disableClose: false };
    TestBed.configureTestingModule({
        imports: [TranslateModule.forRoot(), SettingsProfileDialogComponent],
        providers: [
            {
                provide: MAT_DIALOG_DATA,
                useValue: {
                    suggestedColour: '#3b82f6',
                    submit,
                } satisfies SettingsProfileDialogData,
            },
            { provide: MatDialogRef, useValue: ref },
        ],
    });
    const fixture = TestBed.createComponent(SettingsProfileDialogComponent);
    fixture.componentInstance.name.set('Synthetic Ana');
    fixture.detectChanges();
    return { fixture, close, ref, el: fixture.nativeElement as HTMLElement };
}

describe('SettingsProfileDialogComponent', () => {
    it('closes with true once the save went through', async () => {
        const { fixture, close } = setup(async () => null);
        await fixture.componentInstance.save();
        expect(close).toHaveBeenCalledWith(true);
    });

    it('stays open with the draft and shows the error when the save fails', async () => {
        const submit = jest.fn(async () => ({
            code: 'profile_name_taken' as const,
        }));
        const { fixture, close, el, ref } = setup(submit);
        await fixture.componentInstance.save();
        fixture.detectChanges();
        expect(close).not.toHaveBeenCalled();
        expect(fixture.componentInstance.name()).toBe('Synthetic Ana');
        expect(
            el.querySelector('[data-test-id="profile-form-error"]')?.textContent
        ).toContain('PROFILES.ERRORS.NAME_TAKEN');
        expect(ref.disableClose).toBe(false);
        // Saving again retries with the same draft.
        await fixture.componentInstance.save();
        expect(submit).toHaveBeenCalledTimes(2);
    });

    it('stays open without a message when the follow-up prompt was cancelled', async () => {
        const { fixture, close, el } = setup(async () => 'cancelled');
        await fixture.componentInstance.save();
        fixture.detectChanges();
        expect(close).not.toHaveBeenCalled();
        expect(
            el.querySelector('[data-test-id="profile-form-error"]')
        ).toBeNull();
    });

    it('does not send an invalid form', async () => {
        const submit = jest.fn(async () => null);
        const { fixture } = setup(submit);
        fixture.componentInstance.name.set('  ');
        await fixture.componentInstance.save();
        expect(submit).not.toHaveBeenCalled();
    });
});
