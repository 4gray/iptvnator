import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsBackupFacade } from './settings-backup.facade';
import { SettingsBackupSectionComponent } from './settings-backup-section.component';

describe('SettingsBackupSectionComponent', () => {
    let fixture: ComponentFixture<SettingsBackupSectionComponent>;
    const includeSecrets = signal(false);

    beforeEach(async () => {
        includeSecrets.set(false);
        await TestBed.configureTestingModule({
            imports: [
                SettingsBackupSectionComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: SettingsBackupFacade,
                    useValue: { includeSecrets },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SettingsBackupSectionComponent);
        fixture.componentRef.setInput('activeSection', 'backup');
        fixture.detectChanges();
    });

    it('shows redacted-backup guidance and reveals the secret-export warning only when enabled', () => {
        const nativeElement = fixture.nativeElement as HTMLElement;

        expect(
            nativeElement.querySelector('#backup-redacted-warning')?.textContent
        ).toContain('SETTINGS.BACKUP_REDACTED_WARNING');
        expect(
            nativeElement.querySelector('#backup-secrets-warning')
        ).toBeNull();

        includeSecrets.set(true);
        fixture.detectChanges();

        expect(
            nativeElement.querySelector('#backup-secrets-warning')?.textContent
        ).toContain('SETTINGS.BACKUP_SECRETS_WARNING');
    });
});
