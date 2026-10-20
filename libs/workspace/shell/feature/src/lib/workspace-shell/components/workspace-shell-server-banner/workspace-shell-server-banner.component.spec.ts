import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ServerStorageStatusService } from '@iptvnator/services';
import { WorkspaceShellServerBannerComponent } from './workspace-shell-server-banner.component';

const instance = {
    service: 'iptvnator',
    apiVersion: 1,
    instanceId: 'i',
    storage: 'server',
    auth: 'none',
} as const;

describe('WorkspaceShellServerBannerComponent', () => {
    let fixture: ComponentFixture<WorkspaceShellServerBannerComponent>;
    let status: ServerStorageStatusService;
    const retry = jest.fn();

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                WorkspaceShellServerBannerComponent,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();
        status = TestBed.inject(ServerStorageStatusService);
        fixture = TestBed.createComponent(WorkspaceShellServerBannerComponent);
    });

    const banner = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="server-offline-banner"]'
        );

    it('renders nothing without server storage or while online', () => {
        fixture.detectChanges();
        expect(banner()).toBeNull();

        status.activate(instance, retry);
        fixture.detectChanges();
        expect(banner()).toBeNull();
    });

    it('explains the offline state and retries', () => {
        status.activate(instance, retry);
        status.reportOffline();
        fixture.detectChanges();

        fixture.nativeElement
            .querySelector('[data-test-id="server-offline-retry"]')
            .click();

        expect(banner()?.textContent).toContain(
            'SERVER_STORAGE.OFFLINE_BANNER'
        );
        expect(retry).toHaveBeenCalled();
    });
});
