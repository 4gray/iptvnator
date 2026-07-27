import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    StalkerCredentialsDialogComponent,
    StalkerCredentialsDialogData,
} from './stalker-credentials-dialog.component';
import {
    StalkerOriginApprovalDialogComponent,
    StalkerOriginApprovalDialogData,
} from './stalker-origin-approval-dialog.component';

function configureTranslations(): void {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
        'en',
        {
            CANCEL: 'Cancel',
            HOME: {
                STALKER_PORTAL: {
                    APPROVE_ORIGIN: 'Approve target',
                    CREDENTIALS_DESCRIPTION:
                        'This portal requires registered credentials.',
                    CREDENTIALS_REJECTED:
                        'The saved credentials were rejected.',
                    CREDENTIALS_TITLE: 'Portal credentials',
                    HIDE_PASSWORD: 'Hide password',
                    ORIGIN_APPROVAL_DESCRIPTION:
                        'The MAC is sent only after approval.',
                    ORIGIN_APPROVAL_TITLE: 'Approve portal redirect',
                    ORIGIN_SOURCE: 'Entered origin',
                    ORIGIN_TARGET: 'Redirect target',
                    SHOW_PASSWORD: 'Show password',
                    PASSWORD: 'Password',
                    USERNAME: 'Username',
                    VALIDATE_CREDENTIALS: 'Validate credentials',
                },
            },
        },
        true
    );
    translate.use('en');
}

describe('Stalker route connection dialogs', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('shows the exact redirect origins and returns the explicit approval decision', async () => {
        const dialogRef = { close: jest.fn() };
        await TestBed.configureTestingModule({
            imports: [
                NoopAnimationsModule,
                StalkerOriginApprovalDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        finalOrigin: 'https://portal.example:8443',
                        sourceOrigin: 'https://source.example',
                    } satisfies StalkerOriginApprovalDialogData,
                },
                { provide: MatDialogRef, useValue: dialogRef },
            ],
        }).compileComponents();
        configureTranslations();
        const fixture = TestBed.createComponent(
            StalkerOriginApprovalDialogComponent
        );
        fixture.detectChanges();

        const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
        expect(text).toContain('https://source.example');
        expect(text).toContain('https://portal.example:8443');

        fixture.componentInstance.approve();
        fixture.componentInstance.reject();
        expect(dialogRef.close).toHaveBeenNthCalledWith(1, true);
        expect(dialogRef.close).toHaveBeenNthCalledWith(2, false);
    });

    it('keeps the password masked by default and returns only submitted credentials', async () => {
        const dialogRef = { close: jest.fn() };
        await TestBed.configureTestingModule({
            imports: [
                NoopAnimationsModule,
                StalkerCredentialsDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        savedCredentialsRejected: true,
                        username: 'saved-user',
                    } satisfies StalkerCredentialsDialogData,
                },
                { provide: MatDialogRef, useValue: dialogRef },
            ],
        }).compileComponents();
        configureTranslations();
        const fixture = TestBed.createComponent(
            StalkerCredentialsDialogComponent
        );
        fixture.detectChanges();
        const component = fixture.componentInstance;
        const password = (
            fixture.nativeElement as HTMLElement
        ).querySelector<HTMLInputElement>('input[formControlName="password"]');

        expect(password?.type).toBe('password');
        expect((fixture.nativeElement as HTMLElement).textContent).toContain(
            'The saved credentials were rejected.'
        );

        component.passwordVisible.set(true);
        fixture.detectChanges();
        expect(password?.type).toBe('text');

        component.form.setValue({
            password: ' password with spaces ',
            username: '  replacement-user  ',
        });
        component.submit();
        expect(dialogRef.close).toHaveBeenCalledWith({
            password: ' password with spaces ',
            username: '  replacement-user  ',
        });
    });

    it('does not submit a blank username and supports explicit cancellation', async () => {
        const dialogRef = { close: jest.fn() };
        await TestBed.configureTestingModule({
            imports: [
                NoopAnimationsModule,
                StalkerCredentialsDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        savedCredentialsRejected: false,
                    } satisfies StalkerCredentialsDialogData,
                },
                { provide: MatDialogRef, useValue: dialogRef },
            ],
        }).compileComponents();
        configureTranslations();
        const component = TestBed.createComponent(
            StalkerCredentialsDialogComponent
        ).componentInstance;

        component.form.setValue({ password: '', username: '   ' });
        component.submit();
        expect(dialogRef.close).not.toHaveBeenCalled();

        component.cancel();
        expect(dialogRef.close).toHaveBeenCalledWith(null);
    });
});
