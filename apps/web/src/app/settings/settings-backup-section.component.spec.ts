import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsBackupSectionComponent } from './settings-backup-section.component';

describe('SettingsBackupSectionComponent export availability', () => {
    it.each([true, false])(
        'keeps import available when export support is %s',
        async (supported) => {
            await TestBed.configureTestingModule({
                imports: [
                    SettingsBackupSectionComponent,
                    TranslateModule.forRoot(),
                ],
            }).compileComponents();
            const fixture = TestBed.createComponent(
                SettingsBackupSectionComponent
            );
            fixture.componentRef.setInput('playlistDeleteSummary', {
                total: 0,
                m3u: 0,
                xtream: 0,
                stalker: 0,
            });
            fixture.componentRef.setInput('supportsExport', supported);
            fixture.detectChanges();
            await fixture.whenStable();
            const buttons = Array.from(
                fixture.nativeElement.querySelectorAll('button')
            ) as HTMLButtonElement[];
            expect(
                buttons.some((button) =>
                    button.textContent?.includes('SETTINGS.EXPORT_DATA')
                )
            ).toBe(supported);
            const importButton = buttons.find((button) =>
                button.textContent?.includes('SETTINGS.IMPORT_DATA')
            );
            expect(importButton).toBeDefined();
            expect(importButton?.disabled).toBe(false);
        }
    );
});
