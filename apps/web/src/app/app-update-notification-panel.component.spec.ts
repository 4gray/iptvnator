import {
    ComponentFixture,
    DeferBlockBehavior,
    DeferBlockState,
    TestBed,
} from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import { AppUpdateNotificationCardComponent } from './app-update-notification-card.component';
import { AppUpdateNotificationPanelComponent } from './app-update-notification-panel.component';
import { AppUpdateReleaseNotesDialogComponent } from './settings/app-update-release-notes-dialog.component';

const availableStatus: ElectronBridgeAppUpdateStatus = {
    currentVersion: '0.22.0',
    latestVersion: '0.23.0',
    manualDownloadUrl: 'https://github.com/4gray/iptvnator/releases/latest',
    status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Available,
    supportedSelfUpdate: true,
    channel: 'stable',
    installedChannel: 'stable',
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

    /**
     * Pushes a status and lets the deferred card render: its chunk resolves
     * asynchronously, after which the panel needs one more check.
     */
    async function showUpdate(
        status: ElectronBridgeAppUpdateStatus
    ): Promise<void> {
        statusHandler?.(status);
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));
        fixture.detectChanges();
    }

    function card(): AppUpdateNotificationCardComponent {
        return fixture.debugElement.query(
            By.directive(AppUpdateNotificationCardComponent)
        ).componentInstance as AppUpdateNotificationCardComponent;
    }

    it('renders no card before the main process reports an update', () => {
        expect(
            fixture.nativeElement.querySelector('app-update-notification-card')
        ).toBeNull();
    });

    it('shows a startup update notification when the main process reports an available update', async () => {
        await showUpdate(availableStatus);

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="app-update-notification"]'
            )
        ).not.toBeNull();
    });

    it('hides the notification when it is dismissed', async () => {
        await showUpdate(availableStatus);

        (
            fixture.nativeElement.querySelector(
                '.app-update-notification__header button'
            ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        expect(fixture.componentInstance.dismissedVersion()).toBe('0.23.0');
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="app-update-notification"]'
            )
        ).toBeNull();
    });

    it('opens release notes without dismissing the notification', async () => {
        await showUpdate(availableStatus);

        (
            fixture.nativeElement.querySelector(
                '[data-test-id="app-update-notification-release-notes"]'
            ) as HTMLButtonElement
        ).click();
        // The dialog component is imported on demand (it pulls in `marked`).
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));

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

    it('falls back to the releases page when the release notes dialog fails to load', async () => {
        const open = jest.spyOn(window, 'open').mockReturnValue(null);
        const error = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        await showUpdate(availableStatus);
        const notification = card();
        notification.loadReleaseNotesDialog = () =>
            Promise.reject(new Error('chunk failed'));

        await notification.openReleaseNotes();

        expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
        expect(open).toHaveBeenCalledWith(
            availableStatus.manualDownloadUrl,
            '_blank',
            'noreferrer'
        );
        expect(error).toHaveBeenCalledTimes(1);
        open.mockRestore();
        error.mockRestore();
    });

    it('starts downloading the update from the notification action', async () => {
        await showUpdate(availableStatus);

        (
            fixture.nativeElement.querySelector(
                '[data-test-id="app-update-notification-download"]'
            ) as HTMLButtonElement
        ).click();
        await fixture.whenStable();

        expect(window.electron.downloadAppUpdate).toHaveBeenCalledTimes(1);
        // The card reports the updater's reply back to the panel.
        expect(fixture.componentInstance.status()?.status).toBe(
            ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloading
        );
    });

    it('tells the user when the card chunk cannot be loaded', async () => {
        fixture.destroy();
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [
                AppUpdateNotificationPanelComponent,
                TranslateModule.forRoot(),
            ],
            providers: [{ provide: MatDialog, useValue: { open: jest.fn() } }],
            deferBlockBehavior: DeferBlockBehavior.Manual,
        }).compileComponents();
        fixture = TestBed.createComponent(AppUpdateNotificationPanelComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        statusHandler?.(availableStatus);
        fixture.detectChanges();

        const [block] = await fixture.getDeferBlocks();
        await block.render(DeferBlockState.Error);

        const notice = fixture.nativeElement.querySelector('[role="alert"]');
        expect(notice?.textContent).toContain(
            'SETTINGS.APP_UPDATE_PANEL_UNAVAILABLE'
        );
        expect(
            fixture.nativeElement.querySelector('app-update-notification-card')
        ).toBeNull();
    });

    it('labels unsupported platform action as a GitHub release link', async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        await showUpdate({
            ...availableStatus,
            supportedSelfUpdate: false,
        });

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
