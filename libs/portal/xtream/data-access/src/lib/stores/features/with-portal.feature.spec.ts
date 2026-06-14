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
        error: jest.fn(),
    }),
}));

const PLAYLIST: XtreamPlaylistData = {
    id: 'playlist-1',
    name: 'Portal',
    password: 'pass',
    serverUrl: 'https://example.com',
    type: 'xtream',
    username: 'user',
};

const TestPortalStore = signalStore(withPortal());

describe('withPortal', () => {
    let store: InstanceType<typeof TestPortalStore>;
    let apiService: {
        getAccountInfo: jest.Mock;
    };

    beforeEach(() => {
        apiService = {
            getAccountInfo: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                TestPortalStore,
                {
                    provide: XtreamApiService,
                    useValue: apiService,
                },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: {
                        getPlaylist: jest.fn(),
                    },
                },
            ],
        });

        store = TestBed.inject(TestPortalStore);
        store.setCurrentPlaylist(PLAYLIST);
    });

    it('accepts lowercase active account status and unlimited expiration', async () => {
        apiService.getAccountInfo.mockResolvedValue({
            user_info: {
                auth: 1,
                exp_date: '0',
                status: 'active',
            },
        });

        await expect(store.checkPortalStatus()).resolves.toBe('active');
        expect(store.portalStatus()).toBe('active');
    });

    it('stores allowed output formats from account info on the current playlist', async () => {
        apiService.getAccountInfo.mockResolvedValue({
            user_info: {
                allowed_output_formats: ['m3u8'],
                auth: 1,
                exp_date: '0',
                status: 'Active',
            },
        });

        await store.checkPortalStatus();

        expect(store.currentPlaylist()?.allowedOutputFormats).toEqual(['m3u8']);
    });

    it('clears stale allowed output formats when account info omits them', async () => {
        store.setCurrentPlaylist({
            ...PLAYLIST,
            allowedOutputFormats: ['m3u8'],
        });
        apiService.getAccountInfo.mockResolvedValue({
            user_info: {
                auth: 1,
                exp_date: '0',
                status: 'Active',
            },
        });

        await store.checkPortalStatus();

        expect(store.currentPlaylist()?.allowedOutputFormats).toBeUndefined();
    });
});
