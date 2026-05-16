import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import {
    XTREAM_DATA_SOURCE,
    XtreamPlaylistData,
} from '../../data-sources/xtream-data-source.interface';
import { XtreamApiService } from '../../services/xtream-api.service';
import { withPortal } from './with-portal.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const PLAYLIST: XtreamPlaylistData = {
    id: 'playlist-1',
    name: 'Test Xtream',
    password: 'secret',
    serverUrl: 'http://localhost:3211',
    type: 'xtream',
    username: 'user1',
    vpnLocation: 'HR',
    vpnProvider: 'proton',
};

const TestPortalStore = signalStore(withPortal());

describe('withPortal', () => {
    let store: InstanceType<typeof TestPortalStore>;
    let apiService: {
        getAccountInfo: jest.Mock;
    };
    let dataSource: {
        createPlaylist: jest.Mock;
        getPlaylist: jest.Mock;
    };

    beforeEach(() => {
        apiService = {
            getAccountInfo: jest.fn(),
        };
        dataSource = {
            createPlaylist: jest.fn(),
            getPlaylist: jest.fn().mockResolvedValue(null),
        };

        TestBed.configureTestingModule({
            providers: [
                TestPortalStore,
                { provide: XtreamApiService, useValue: apiService },
                { provide: XTREAM_DATA_SOURCE, useValue: dataSource },
            ],
        });

        store = TestBed.inject(TestPortalStore);
        store.setPlaylistId(PLAYLIST.id);
        store.setCurrentPlaylist(PLAYLIST);
    });

    it('treats authenticated Xtream account responses without a status field as active', async () => {
        apiService.getAccountInfo.mockResolvedValue({
            user_info: {
                auth: 1,
                exp_date: '0',
            },
        });

        await expect(store.checkPortalStatus()).resolves.toBe('active');
        expect(store.portalStatus()).toBe('active');
    });

    it('handles lowercase active status and non-expiring accounts', async () => {
        apiService.getAccountInfo.mockResolvedValue({
            user_info: {
                exp_date: '0',
                status: 'active',
            },
        });

        await expect(store.checkPortalStatus()).resolves.toBe('active');
        expect(store.portalStatus()).toBe('active');
    });

    it('passes per-source VPN context to the account status request', async () => {
        apiService.getAccountInfo.mockResolvedValue({
            user_info: {
                status: 'Active',
            },
        });

        await store.checkPortalStatus();

        expect(apiService.getAccountInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceVpn: {
                    location: 'HR',
                    provider: 'proton',
                    sourceId: PLAYLIST.id,
                    sourceTitle: PLAYLIST.name,
                },
            })
        );
    });
});
