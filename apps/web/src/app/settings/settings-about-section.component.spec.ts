import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { SettingsAboutSectionComponent } from './settings-about-section.component';

function getButton(fixture: ComponentFixture<SettingsAboutSectionComponent>, id: string) {
    return fixture.nativeElement.querySelector(
        `[data-test-id="${id}"]`
    ) as HTMLButtonElement | null;
}

function configureComponent(
    fixture: ComponentFixture<SettingsAboutSectionComponent>,
    status: ElectronBridgeAppUpdateStatus
) {
    fixture.componentRef.setInput('activeSection', 'about');
    fixture.componentRef.setInput('isDesktop', true);
    fixture.componentRef.setInput('version', '0.22.0');
    fixture.componentRef.setInput('updateMessage', '');
    fixture.componentRef.setInput('appUpdateStatus', status);
    fixture.detectChanges();
}

describe('SettingsAboutSectionComponent app updates', () => {
    let fixture: ComponentFixture<SettingsAboutSectionComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                SettingsAboutSectionComponent,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SettingsAboutSectionComponent);
    });

    it('emits a download request when a supported update is available', () => {
        const download = jest.fn();
        fixture.componentInstance.downloadAppUpdate.subscribe(download);
        const openNotes = jest.fn();
        fixture.componentInstance.openAppUpdateReleaseNotes.subscribe(openNotes);
        configureComponent(fixture, {
            currentVersion: '0.22.0',
            latestVersion: '0.23.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
            supportedSelfUpdate: true,
        });

        getButton(fixture, 'app-update-download')?.click();

        expect(getButton(fixture, 'app-update-download')).toBeTruthy();
        expect(download).toHaveBeenCalledTimes(1);

        getButton(fixture, 'app-update-release-notes')?.click();

        expect(getButton(fixture, 'app-update-release-notes')).toBeTruthy();
        expect(openNotes).toHaveBeenCalledTimes(1);
    });

    it('emits an install request after the update has downloaded', () => {
        const install = jest.fn();
        fixture.componentInstance.installAppUpdate.subscribe(install);
        configureComponent(fixture, {
            currentVersion: '0.22.0',
            latestVersion: '0.23.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded,
            supportedSelfUpdate: true,
        });

        getButton(fixture, 'app-update-install')?.click();

        expect(getButton(fixture, 'app-update-install')).toBeTruthy();
        expect(install).toHaveBeenCalledTimes(1);
    });

    it('shows release notes for the current version when no update is available', () => {
        const openNotes = jest.fn();
        fixture.componentInstance.openAppUpdateReleaseNotes.subscribe(openNotes);
        configureComponent(fixture, {
            currentVersion: '0.22.0',
            latestVersion: '0.22.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.NotAvailable,
            supportedSelfUpdate: true,
        });

        getButton(fixture, 'app-update-release-notes')?.click();

        expect(getButton(fixture, 'app-update-release-notes')).toBeTruthy();
        expect(openNotes).toHaveBeenCalledTimes(1);
    });

    it('emits a manual release request for unsupported Linux packages', () => {
        const openManual = jest.fn();
        fixture.componentInstance.openManualAppUpdate.subscribe(openManual);
        configureComponent(fixture, {
            currentVersion: '0.22.0',
            latestVersion: '0.23.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported,
            supportedSelfUpdate: false,
        });

        getButton(fixture, 'app-update-open-release')?.click();

        expect(getButton(fixture, 'app-update-open-release')).toBeTruthy();
        expect(openManual).toHaveBeenCalledTimes(1);
    });

    it('uses a neutral status label before unsupported packages have checked GitHub releases', () => {
        configureComponent(fixture, {
            currentVersion: '0.22.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Unsupported,
            supportedSelfUpdate: false,
        });

        expect(fixture.componentInstance.appUpdateStatusLabelKey()).toBe(
            'SETTINGS.APP_UPDATE_IDLE'
        );
        expect(getButton(fixture, 'app-update-open-release')).toBeTruthy();
    });
});
