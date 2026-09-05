import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { StalkerAccountInfoService } from '@iptvnator/portal/stalker/data-access';
import { DataService, PlaylistsService } from '@iptvnator/services';
import {
    CONNECTIVITY_GUARD_RESET,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import { StalkerAccountInfoComponent } from './stalker-account-info.component';

describe('StalkerAccountInfoComponent', () => {
    let fixture: ComponentFixture<StalkerAccountInfoComponent>;
    let component: StalkerAccountInfoComponent;
    let accountInfoService: { fetchAccountInfo: jest.Mock };
    let dataService: { sendIpcEvent: jest.Mock };
    let playlistsService: { getPlaylist: jest.Mock };

    const playlist = {
        _id: 'stalker-1',
        title: 'Living Room Portal',
        count: 0,
        importDate: '2026-04-05T10:00:00.000Z',
        autoRefresh: false,
        macAddress: '00:1A:79:00:00:01',
        portalUrl: 'http://portal.example/portal.php',
    } as PlaylistMeta;

    const freshSnapshot = {
        login: 'user-42',
        // floor, not round: rounding the epoch up puts the expiry a few
        // hundred ms past the 30-day mark and ceil() then yields 31.
        expireDate: Math.floor(Date.now() / 1000) + 30 * 86_400,
        tariffPlanName: 'Premium',
        status: 1,
    };

    const cachedSnapshot = {
        login: 'cached-user',
        expireDate: Math.floor(Date.now() / 1000) + 3 * 86_400,
        tariffPlanName: 'Basic',
        status: 1,
    };

    async function createComponent(): Promise<void> {
        await TestBed.configureTestingModule({
            imports: [
                StalkerAccountInfoComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: DataService, useValue: dataService },
                { provide: MAT_DIALOG_DATA, useValue: { playlist } },
                {
                    provide: StalkerAccountInfoService,
                    useValue: accountInfoService,
                },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(StalkerAccountInfoComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
        // The constructor load chains several awaits (cache read, portal
        // fetch); a macrotask hop drains the remaining microtask chain.
        await new Promise((resolve) => setTimeout(resolve));
        fixture.detectChanges();
    }

    beforeEach(() => {
        accountInfoService = {
            fetchAccountInfo: jest.fn().mockResolvedValue(freshSnapshot),
        };
        dataService = {
            sendIpcEvent: jest.fn().mockResolvedValue({ success: true }),
        };
        playlistsService = {
            getPlaylist: jest.fn().mockReturnValue(of(null)),
        };
    });

    it.each([false, true])(
        'explains a paused refresh with cached snapshot=%s and allows retry',
        async (cached) => {
            if (cached)
                playlistsService.getPlaylist.mockReturnValue(
                    of({ ...playlist, stalkerAccountInfo: cachedSnapshot })
                );
            accountInfoService.fetchAccountInfo.mockRejectedValueOnce(
                new Error(
                    "Error invoking remote method 'STALKER_REQUEST': Portal http://portal.example is not responding; skipped after repeated connection failures"
                )
            );
            await createComponent();
            expect(component.requestsPaused()).toBe(true);
            expect(component.isCachedSnapshot()).toBe(cached);
            expect(fixture.nativeElement.textContent).toContain(
                'PORTALS.REQUESTS_PAUSED.DESCRIPTION'
            );
            expect(fixture.nativeElement.textContent).toContain(
                'PORTALS.REQUESTS_PAUSED.RETRY'
            );
            await component.reload();
            expect(component.requestsPaused()).toBe(false);
            expect(component.refreshFailed()).toBe(false);
        }
    );

    it('shows the fresh snapshot when the portal answers', async () => {
        await createComponent();

        expect(component.loadState()).toBe('ready');
        expect(component.snapshot()).toEqual(freshSnapshot);
        expect(component.snapshotSource()).toBe('fresh');
        expect(component.isCachedSnapshot()).toBe(false);
        expect(component.statusKind()).toBe('active');
        expect(component.daysLeft()).toBe(30);
        expect(component.expiresSoon()).toBe(false);
    });

    it('falls back to the cached import snapshot when the refresh fails', async () => {
        accountInfoService.fetchAccountInfo.mockRejectedValue(
            new Error('offline')
        );
        playlistsService.getPlaylist.mockReturnValue(
            of({ stalkerAccountInfo: cachedSnapshot })
        );

        await createComponent();

        expect(component.loadState()).toBe('ready');
        expect(component.snapshot()).toEqual(cachedSnapshot);
        expect(component.snapshotSource()).toBe('cached');
        expect(component.refreshFailed()).toBe(true);
        expect(component.expiresSoon()).toBe(true);
    });

    it('normalizes stringly-typed cached values persisted at import time', async () => {
        accountInfoService.fetchAccountInfo.mockRejectedValue(
            new Error('offline')
        );
        playlistsService.getPlaylist.mockReturnValue(
            of({
                stalkerAccountInfo: {
                    login: 'cached-user',
                    // Import persists portal values verbatim; a date string
                    // must not blow up daysLeft/expiry rendering.
                    expireDate: '2099-12-31',
                    status: '1',
                },
            })
        );

        await createComponent();

        expect(component.loadState()).toBe('ready');
        expect(component.statusKind()).toBe('active');
        expect(component.expiryDate()?.getFullYear()).toBe(2099);
        expect(component.daysLeft()).toBeGreaterThan(0);
    });

    it('keeps the cached snapshot when the portal publishes nothing', async () => {
        accountInfoService.fetchAccountInfo.mockResolvedValue(null);
        playlistsService.getPlaylist.mockReturnValue(
            of({ stalkerAccountInfo: cachedSnapshot })
        );

        await createComponent();

        expect(component.loadState()).toBe('ready');
        expect(component.snapshot()).toEqual(cachedSnapshot);
        expect(component.snapshotSource()).toBe('cached');
        expect(component.refreshFailed()).toBe(false);
    });

    it('shows the error state when there is no data at all', async () => {
        accountInfoService.fetchAccountInfo.mockRejectedValue(
            new Error('offline')
        );

        await createComponent();

        expect(component.loadState()).toBe('error');
        expect(component.snapshot()).toBeNull();
    });

    it('stays ready with an empty account panel when the portal is reachable but silent', async () => {
        accountInfoService.fetchAccountInfo.mockResolvedValue(null);

        await createComponent();

        expect(component.loadState()).toBe('ready');
        expect(component.snapshot()).toBeNull();
        expect(component.accountDetails()).toEqual([]);
        // Portal facts are always known, even without account data.
        expect(component.portalDetails().map((row) => row.value)).toEqual([
            playlist.portalUrl,
            playlist.macAddress,
        ]);
    });

    it('survives a broken cache read and still shows fresh data', async () => {
        playlistsService.getPlaylist.mockReturnValue(
            throwError(() => new Error('db locked'))
        );

        await createComponent();

        expect(component.loadState()).toBe('ready');
        expect(component.snapshot()).toEqual(freshSnapshot);
        expect(component.snapshotSource()).toBe('fresh');
    });

    it('reports an expiry that passed hours ago as expired, not "0 days left"', async () => {
        accountInfoService.fetchAccountInfo.mockResolvedValue({
            ...freshSnapshot,
            expireDate: Math.floor(Date.now() / 1000) - 3600,
        });

        await createComponent();

        // Math.ceil of a fraction of a day rounds up to 0/-0, so the
        // counter must not decide expiry.
        expect(component.daysLeft()).toBe(-0);
        expect(component.hasExpired()).toBe(true);
        expect(component.heroStats()[0].labelKey).toBe(
            'STALKER.ACCOUNT_INFO.EXPIRED'
        );
    });

    it('labels a restored full portal by URL when the flag is absent', async () => {
        await TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [
                StalkerAccountInfoComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: DataService,
                    useValue: { sendIpcEvent: jest.fn() },
                },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        playlist: {
                            ...playlist,
                            portalUrl:
                                'http://portal.example/stalker_portal/c/',
                            isFullStalkerPortal: undefined,
                        },
                    },
                },
                {
                    provide: StalkerAccountInfoService,
                    useValue: accountInfoService,
                },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        }).compileComponents();

        const restored = TestBed.createComponent(StalkerAccountInfoComponent);
        restored.detectChanges();
        await restored.whenStable();

        // Presentation must agree with the fetch path, which resolves the
        // portal type from the URL when the flag is missing.
        expect(restored.componentInstance.isFullPortal).toBe(true);
        expect(restored.nativeElement.textContent).toContain(
            'STALKER.ACCOUNT_INFO.PORTAL_TYPE_FULL'
        );
        expect(restored.nativeElement.textContent).not.toContain(
            'STALKER.ACCOUNT_INFO.PORTAL_TYPE_LEGACY'
        );
    });

    it('renders no status pill for unknown status values', async () => {
        accountInfoService.fetchAccountInfo.mockResolvedValue({
            ...freshSnapshot,
            status: 7,
        });

        await createComponent();

        expect(component.statusKind()).toBeNull();
        expect(
            component
                .accountDetails()
                .find((row) => row.labelKey === 'STALKER.ACCOUNT_INFO.STATUS')
        ).toBeUndefined();
    });

    it('clears the connectivity guard before the Retry button re-reads the profile', async () => {
        // The profile request is exactly what a tripped guard fast-fails, so a
        // reset placed after it would leave Retry doing nothing for 30 seconds.
        // Opening the dialog deliberately does not reset.
        await createComponent();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        accountInfoService.fetchAccountInfo.mockClear();

        await component.reload();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            CONNECTIVITY_GUARD_RESET,
            { url: playlist.portalUrl }
        );
        expect(
            dataService.sendIpcEvent.mock.invocationCallOrder[0]
        ).toBeLessThan(
            accountInfoService.fetchAccountInfo.mock.invocationCallOrder[0]
        );
    });
});
