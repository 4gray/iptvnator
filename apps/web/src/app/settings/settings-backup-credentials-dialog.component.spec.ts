import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    SettingsBackupCredentialsDialogComponent,
    SettingsBackupCredentialsDialogData,
} from './settings-backup-credentials-dialog.component';

describe('SettingsBackupCredentialsDialogComponent', () => {
    let component: SettingsBackupCredentialsDialogComponent;
    let fixture: ComponentFixture<SettingsBackupCredentialsDialogComponent>;
    let dialogRef: { close: jest.Mock };

    beforeEach(async () => {
        dialogRef = {
            close: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                SettingsBackupCredentialsDialogComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        playlistTitle: 'Living room',
                        serverHost: 'provider.example:8443',
                    } satisfies SettingsBackupCredentialsDialogData,
                },
                {
                    provide: MatDialogRef,
                    useValue: dialogRef,
                },
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation(
            'en',
            {
                SETTINGS: {
                    BACKUP_CREDENTIALS_DIALOG: {
                        TITLE: 'Xtream credentials required',
                        MESSAGE:
                            'This redacted backup does not contain the credentials for this playlist.',
                        PLAYLIST: 'Playlist',
                        SERVER: 'Server',
                        USERNAME: 'Username',
                        PASSWORD: 'Password',
                        USERNAME_REQUIRED: 'Enter a username.',
                        PASSWORD_REQUIRED: 'Enter a password.',
                        SKIP: 'Skip playlist',
                        IMPORT: 'Import playlist',
                    },
                },
            },
            true
        );
        translate.use('en');

        fixture = TestBed.createComponent(
            SettingsBackupCredentialsDialogComponent
        );
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('identifies the redacted playlist without exposing a full source URL', () => {
        const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

        expect(text).toContain('Xtream credentials required');
        expect(text).toContain('Living room');
        expect(text).toContain('provider.example:8443');
    });

    it('marks blank credentials as invalid and keeps the dialog open', () => {
        component.credentialsForm.setValue({
            username: '   ',
            password: '   ',
        });

        component.submit();
        fixture.detectChanges();

        expect(component.credentialsForm.invalid).toBe(true);
        expect(component.credentialsForm.controls.username.touched).toBe(true);
        expect(component.credentialsForm.controls.password.touched).toBe(true);
        expect(dialogRef.close).not.toHaveBeenCalled();

        const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
        expect(text).toContain('Enter a username.');
        expect(text).toContain('Enter a password.');
    });

    it('returns the username and password exactly as entered', () => {
        component.credentialsForm.setValue({
            username: '  viewer  ',
            password: ' secret with spaces ',
        });

        component.submit();

        expect(dialogRef.close).toHaveBeenCalledWith({
            username: '  viewer  ',
            password: ' secret with spaces ',
        });
    });

    it('returns null when the playlist is skipped', () => {
        component.skip();

        expect(dialogRef.close).toHaveBeenCalledWith(null);
    });
});
