import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { Language } from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsGeneralSectionComponent } from './settings-general-section.component';

describe('Android Device settings', () => {
    const openDeviceSettings = jest.fn();
    const openExternal = jest.fn(() => true);
    const shellWindow = window as Window & { __tvShell?: unknown };

    beforeEach(async () => {
        openDeviceSettings.mockClear();
        openExternal.mockClear();
        await TestBed.configureTestingModule({
            imports: [
                SettingsGeneralSectionComponent,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();
    });

    afterEach(() => {
        delete shellWindow.__tvShell;
    });

    function render(shell?: unknown) {
        shellWindow.__tvShell = shell;
        const fixture = TestBed.createComponent(
            SettingsGeneralSectionComponent
        );
        const form = new FormGroup({
            language: new FormControl('en'),
            startupBehavior: new FormControl('dashboard'),
            stripCountryPrefix: new FormControl(false),
        });
        fixture.componentRef.setInput('form', form);
        fixture.componentRef.setInput('languageEnum', Language);
        fixture.componentRef.setInput('startupBehaviorOptions', []);
        fixture.componentRef.setInput('startupWindowModeOptions', []);
        fixture.detectChanges();
        const buttons = (
            fixture.nativeElement as HTMLElement
        ).querySelectorAll<HTMLButtonElement>(
            '[data-test-id="android-device-settings"]'
        );
        return { buttons, form };
    }

    it('opens the native dialog from one focusable button without editing General preferences', () => {
        const { buttons, form } = render({
            handheld: true,
            openDeviceSettings,
            openExternal,
        });

        expect(buttons).toHaveLength(1);
        const button = buttons[0];
        expect(button.type).toBe('button');
        expect(button.textContent?.trim()).toBe('SETTINGS.DEVICE_SETTINGS');
        expect(button.getAttribute('aria-haspopup')).toBe('dialog');
        button.focus();
        expect(document.activeElement).toBe(button);
        button.click();
        expect(openDeviceSettings).toHaveBeenCalledTimes(1);
        expect(openExternal).not.toHaveBeenCalled();
        expect(form.pristine).toBe(true);
    });

    it.each([
        ['browser and desktop', undefined],
        ['Android TV', { handheld: false, openDeviceSettings, openExternal }],
        [
            'handheld missing the native action',
            { handheld: true, openExternal },
        ],
    ])('hides the button for %s', (_platform, shell) => {
        expect(render(shell).buttons).toHaveLength(0);
    });
});
