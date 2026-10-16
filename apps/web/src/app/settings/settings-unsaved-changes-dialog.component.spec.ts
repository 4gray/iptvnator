import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    SettingsUnsavedChangesDialogComponent,
    SettingsUnsavedChangesDialogData,
} from './settings-unsaved-changes-dialog.component';

describe('SettingsUnsavedChangesDialogComponent', () => {
    let fixture: ComponentFixture<SettingsUnsavedChangesDialogComponent>;

    async function render(data: SettingsUnsavedChangesDialogData) {
        await TestBed.configureTestingModule({
            imports: [
                SettingsUnsavedChangesDialogComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [{ provide: MAT_DIALOG_DATA, useValue: data }],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            CANCEL: 'Cancel',
            SETTINGS: {
                UNSAVED_DIALOG_DISCARD: 'Discard',
                UNSAVED_DIALOG_SAVE: 'Save',
            },
        });
        translate.use('en');

        fixture = TestBed.createComponent(
            SettingsUnsavedChangesDialogComponent
        );
        fixture.detectChanges();
    }

    function actionButtons(): HTMLButtonElement[] {
        return Array.from(
            fixture.nativeElement.querySelectorAll(
                '.unsaved-dialog__actions button'
            )
        );
    }

    it('orders the actions dismiss first and the primary save last', async () => {
        await render({ canSave: true });

        expect(
            actionButtons().map((button) => [
                button.getAttribute('data-test-id'),
                button.textContent?.trim(),
            ])
        ).toEqual([
            ['unsaved-dialog-stay', 'Cancel'],
            ['unsaved-dialog-discard', 'Discard'],
            ['unsaved-dialog-save', 'Save'],
        ]);
    });

    it('keeps the initial focus on the dismiss so Enter stays safe', async () => {
        await render({ canSave: true });

        const [dismiss, discard, save] = actionButtons();
        expect(dismiss.hasAttribute('cdkFocusInitial')).toBe(true);
        expect(discard.hasAttribute('cdkFocusInitial')).toBe(false);
        expect(save.hasAttribute('cdkFocusInitial')).toBe(false);
    });

    it('marks only Discard as destructive: it throws away the edits', async () => {
        await render({ canSave: true });

        expect(
            actionButtons().map((button) =>
                button.classList.contains('app-destructive-button')
            )
        ).toEqual([false, true, false]);
    });

    it('disables save while the form cannot be saved', async () => {
        await render({ canSave: false });

        const [, discard, save] = actionButtons();
        expect(save.disabled).toBe(true);
        expect(discard.disabled).toBe(false);
    });
});
