import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { Language } from '@iptvnator/shared/interfaces';
import { SettingsGeneralSectionComponent } from './settings-general-section.component';

// Settings renders inside the workspace shell, which provides the
// shortcuts service; the stand-in keeps the shell's barrel out of the test.
jest.mock('@iptvnator/workspace/shell/feature', () => ({
    WorkspaceKeyboardShortcutsService: class {
        openShortcutsDialog(): void {
            // Replaced per test.
        }
    },
}));

function createSection(
    providers: unknown[] = []
): ComponentFixture<SettingsGeneralSectionComponent> {
    TestBed.configureTestingModule({
        imports: [
            SettingsGeneralSectionComponent,
            NoopAnimationsModule,
            TranslateModule.forRoot(),
        ],
        providers: providers as never[],
    });
    const fixture = TestBed.createComponent(SettingsGeneralSectionComponent);
    fixture.componentRef.setInput(
        'form',
        new FormGroup({
            language: new FormControl(Language.ENGLISH),
            startupBehavior: new FormControl(null),
            startupWindowMode: new FormControl(null),
            stripCountryPrefix: new FormControl(false),
            portalConnectivityGuard: new FormControl(false),
        })
    );
    fixture.componentRef.setInput('languageEnum', Language);
    fixture.componentRef.setInput('startupBehaviorOptions', []);
    fixture.componentRef.setInput('startupWindowModeOptions', []);
    fixture.detectChanges();
    return fixture;
}

function shortcutsButton(
    fixture: ComponentFixture<SettingsGeneralSectionComponent>
): HTMLButtonElement {
    return fixture.nativeElement.querySelector(
        '[data-test-id="settings-open-keyboard-shortcuts"]'
    );
}

describe('SettingsGeneralSectionComponent keyboard shortcuts', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('opens the shell shortcuts dialog from the Help row', async () => {
        // The same import the component makes, so both see one token.
        const { WorkspaceKeyboardShortcutsService } =
            await import('@iptvnator/workspace/shell/feature');
        const openShortcutsDialog = jest.fn();
        const fixture = createSection([
            {
                provide: WorkspaceKeyboardShortcutsService,
                useValue: { openShortcutsDialog },
            },
        ]);
        const row = fixture.nativeElement.querySelector(
            '[data-setting-id="keyboard-shortcuts"]'
        );
        expect(row).not.toBeNull();

        shortcutsButton(fixture).click();
        await fixture.whenStable();
        await Promise.resolve();

        expect(openShortcutsDialog).toHaveBeenCalledTimes(1);
    });

    it('does nothing outside the shell', async () => {
        const fixture = createSection();

        shortcutsButton(fixture).click();

        await expect(fixture.whenStable()).resolves.not.toThrow();
    });
});
