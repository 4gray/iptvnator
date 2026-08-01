import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { StalkerAccountInfoService } from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerAccountInfoComponent } from './stalker-account-info.component';

describe('StalkerAccountInfoComponent', () => {
    let fixture: ComponentFixture<StalkerAccountInfoComponent>;
    let component: StalkerAccountInfoComponent;
    let accountInfoService: { fetchAccountInfo: jest.Mock };
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
        playlistsService = {
            getPlaylist: jest.fn().mockReturnValue(of(null)),
        };
    });

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
});
