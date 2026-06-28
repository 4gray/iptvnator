import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateNotificationPanelComponent } from './app-update-notification-panel.component';
import { AppUpdateReleaseNotesDialogComponent } from './settings/app-update-release-notes-dialog.component';

const availableStatus: ElectronBridgeAppUpdateStatus = {
    currentVersion: '0.22.0',
    latestVersion: '0.23.0',
    manualDownloadUrl: 'https://github.com/4gray/iptvnator/releases/latest',
    status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
    supportedSelfUpdate: true,
};

describe('AppUpdateNotificationPanelComponent', () => {
    let fixture: ComponentFixture<AppUpdateNotificationPanelComponent>;
    const originalElectron = window.electron;
    let statusHandler: ((status: ElectronBridgeAppUpdateStatus) => void) | null;

    beforeEach(async () => {
        statusHandler = null;
        window.electron = {
            downloadAppUpdate: jest.fn().mockResolvedValue({
                ...availableStatus,
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading,
            }),
            getAppUpdateStatus: jest.fn().mockResolvedValue({
                ...availableStatus,
                status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Idle,
            }),
            onAppUpdateStatusChange: jest.fn((handler) => {
                statusHandler = handler;
                return jest.fn();
            }),
        } as unknown as typeof window.electron;

        await TestBed.configureTestingModule({
            imports: [
                AppUpdateNotificationPanelComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MatDialog,
                    useValue: { open: jest.fn() },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AppUpdateNotificationPanelComponent);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('shows a startup update notification when the main process reports an available update', () => {
        statusHandler?.(availableStatus);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="app-update-notification"]'
            )
        ).not.toBeNull();
    });

    it('opens release notes without dismissing the notification', () => {
        statusHandler?.(availableStatus);
        fixture.detectChanges();

        (
            fixture.nativeElement.querySelector(
                '[data-test-id="app-update-notification-release-notes"]'
            ) as HTMLButtonElement
        ).click();

        expect(TestBed.inject(MatDialog).open).toHaveBeenCalledWith(
            AppUpdateReleaseNotesDialogComponent,
            expect.objectContaining({
                data: { initialVersion: '0.23.0' },
            })
        );
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="app-update-notification"]'
            )
        ).not.toBeNull();
    });

    it('starts downloading the update from the notification action', async () => {
        statusHandler?.(availableStatus);
        fixture.detectChanges();

        (
            fixture.nativeElement.querySelector(
                '[data-test-id="app-update-notification-download"]'
            ) as HTMLButtonElement
        ).click();
        await fixture.whenStable();

        expect(window.electron.downloadAppUpdate).toHaveBeenCalledTimes(1);
    });

    it('labels unsupported platform action as a GitHub release link', () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        statusHandler?.({
            ...availableStatus,
            supportedSelfUpdate: false,
        });
        fixture.detectChanges();

        const button = fixture.nativeElement.querySelector(
            '[data-test-id="app-update-notification-download"]'
        ) as HTMLButtonElement;

        expect(button.textContent).toContain(
            'SETTINGS.APP_UPDATE_OPEN_RELEASE'
        );
        expect(button.querySelector('mat-icon')?.textContent?.trim()).toBe(
            'open_in_new'
        );

        button.click();

        expect(window.electron.downloadAppUpdate).not.toHaveBeenCalled();
        expect(open).toHaveBeenCalledWith(
            availableStatus.manualDownloadUrl,
            '_blank',
            'noreferrer'
        );
        open.mockRestore();
    });
});
