import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { SettingsAboutSectionComponent } from './settings-about-section.component';
import { SETTINGS_UPDATE_CHANNEL_OPTIONS } from './settings-options';

function getButton(fixture: ComponentFixture<SettingsAboutSectionComponent>, id: string) {
    return fixture.nativeElement.querySelector(
        `[data-test-id="${id}"]`
    ) as HTMLButtonElement | null;
}

function configureComponent(
    fixture: ComponentFixture<SettingsAboutSectionComponent>,
    status: ElectronBridgeAppUpdateStatus
) {
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

describe('SettingsAboutSectionComponent version display', () => {
    let fixture: ComponentFixture<SettingsAboutSectionComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                SettingsAboutSectionComponent,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SettingsAboutSectionComponent);
        fixture.componentRef.setInput('version', '0.23.0');
    });

    function getVersionBlock() {
        return fixture.nativeElement.querySelector(
            '[data-test-id="app-version"]'
        ) as HTMLElement;
    }

    function getCommitMarker() {
        return fixture.nativeElement.querySelector(
            '[data-test-id="app-build-commit"]'
        ) as HTMLElement | null;
    }

    it('shows the shortened build commit next to the version on CI builds', () => {
        fixture.componentRef.setInput(
            'buildCommit',
            '949ea520aa11bb22cc33dd44ee55ff6677889900'
        );
        fixture.detectChanges();

        expect(getVersionBlock().textContent).toContain('0.23.0');
        expect(getCommitMarker()?.textContent).toBe('(949ea52)');
        expect(getCommitMarker()?.getAttribute('title')).toBe(
            '949ea520aa11bb22cc33dd44ee55ff6677889900'
        );
    });

    it('shows the plain version when no build commit was injected', () => {
        fixture.detectChanges();

        expect(getVersionBlock().textContent).toContain('0.23.0');
        expect(getCommitMarker()).toBeNull();
    });

    it('treats a whitespace-only commit as absent', () => {
        fixture.componentRef.setInput('buildCommit', '   ');
        fixture.detectChanges();

        expect(getCommitMarker()).toBeNull();
    });
});

describe('SettingsAboutSectionComponent update channel', () => {
    let fixture: ComponentFixture<SettingsAboutSectionComponent>;

    const query = (id: string) =>
        fixture.nativeElement.querySelector(
            `[data-test-id="${id}"]`
        ) as HTMLElement | null;

    const configure = (
        status: Partial<ElectronBridgeAppUpdateStatus>,
        form: FormGroup | null
    ) => {
        fixture.componentRef.setInput('isDesktop', true);
        fixture.componentRef.setInput('form', form);
        fixture.componentRef.setInput(
            'updateChannelOptions',
            SETTINGS_UPDATE_CHANNEL_OPTIONS
        );
        fixture.componentRef.setInput('appUpdateStatus', {
            currentVersion: '0.23.0',
            manualDownloadUrl:
                'https://github.com/4gray/iptvnator/releases/latest',
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Idle,
            supportedSelfUpdate: true,
            channel: 'stable',
            installedChannel: 'stable',
            ...status,
        });
        fixture.detectChanges();
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                SettingsAboutSectionComponent,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SettingsAboutSectionComponent);
    });

    it('binds the channel select to the shared settings form', () => {
        const form = new FormGroup({
            updateChannel: new FormControl('stable'),
        });
        configure({}, form);

        expect(query('select-update-channel')).not.toBeNull();
        expect(query('app-update-channel-nightly-warning')).toBeNull();

        form.controls.updateChannel.setValue('nightly');
        fixture.detectChanges();

        expect(query('app-update-channel-nightly-warning')).not.toBeNull();
    });

    it('renders no channel control without a form to bind to', () => {
        configure({}, null);

        expect(query('select-update-channel')).toBeNull();
    });

    it('explains that a nightly build on the stable channel waits for the next release', () => {
        const form = new FormGroup({
            updateChannel: new FormControl('stable'),
        });
        configure(
            {
                currentVersion: '0.23.1-nightly.20260915.7',
                installedChannel: 'nightly',
            },
            form
        );

        expect(query('app-update-nightly-on-stable-hint')).not.toBeNull();

        configure({ channel: 'nightly', installedChannel: 'nightly' }, form);

        expect(query('app-update-nightly-on-stable-hint')).toBeNull();
    });
});
