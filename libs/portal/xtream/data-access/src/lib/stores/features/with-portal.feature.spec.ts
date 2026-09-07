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

const PLAYLIST_CONNECTION = {
    serverUrl: PLAYLIST.serverUrl,
    username: PLAYLIST.username,
    password: PLAYLIST.password,
};

// 2026-09-06 19:30:00 UTC
const SERVER_EPOCH = 1_788_723_000;

const TestPortalStore = signalStore(withPortal());

describe('withPortal', () => {
    let store: InstanceType<typeof TestPortalStore>;
    let apiService: {
        getAccountInfo: jest.Mock;
    };
    let rememberServerTimezone: jest.Mock;

    beforeEach(() => {
        apiService = {
            getAccountInfo: jest.fn(),
        };
        rememberServerTimezone = jest.fn().mockResolvedValue(undefined);

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
                        rememberServerTimezone,
                    },
                },
            ],
        });

        store = TestBed.inject(TestPortalStore);
        store.setCurrentPlaylist(PLAYLIST);
    });

    function respondWith(serverInfo: Record<string, unknown> | undefined) {
        apiService.getAccountInfo.mockResolvedValue({
            user_info: {
                auth: 1,
                exp_date: '0',
                status: 'Active',
            },
            ...(serverInfo ? { server_info: serverInfo } : {}),
        });
    }

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

    describe('server timezone (issue #1562)', () => {
        it('keeps the learned IANA timezone in the store AND hands it to the data source for the stored row', async () => {
            respondWith({ timezone: 'Europe/London' });

            await store.checkPortalStatus();

            expect(store.currentPlaylist()?.serverTimezone).toBe(
                'Europe/London'
            );
            expect(rememberServerTimezone).toHaveBeenCalledWith(
                PLAYLIST.id,
                PLAYLIST_CONNECTION,
                'Europe/London'
            );
        });

        it('derives a fixed offset from the panel clock when the timezone name is unusable', async () => {
            respondWith({
                timezone: 'UTC+3',
                time_now: '2026-09-06 22:30:00',
                timestamp_now: SERVER_EPOCH,
            });

            await store.checkPortalStatus();

            expect(store.currentPlaylist()?.serverTimezone).toBe('UTC+03:00');
            expect(rememberServerTimezone).toHaveBeenCalledWith(
                PLAYLIST.id,
                PLAYLIST_CONNECTION,
                'UTC+03:00'
            );
        });

        it('offers the value to the data source even when the store already carries it', async () => {
            // The store cannot know whether the ROW has it (a transient
            // write failure leaves them apart); the data source decides.
            store.setCurrentPlaylist({ ...PLAYLIST, serverTimezone: 'UTC' });
            respondWith({ timezone: 'UTC' });

            await store.checkPortalStatus();

            expect(rememberServerTimezone).toHaveBeenCalledWith(
                PLAYLIST.id,
                PLAYLIST_CONNECTION,
                'UTC'
            );
        });

        it('keeps the previously known timezone when the response carries no usable clock', async () => {
            store.setCurrentPlaylist({
                ...PLAYLIST,
                serverTimezone: 'Europe/London',
            });
            respondWith({ timezone: '' });

            await store.checkPortalStatus();

            expect(store.currentPlaylist()?.serverTimezone).toBe(
                'Europe/London'
            );
            expect(rememberServerTimezone).not.toHaveBeenCalled();
        });

        it('hands a late answer to the data source under the playlist and connection that asked, never the one selected meanwhile', async () => {
            const other: XtreamPlaylistData = {
                ...PLAYLIST,
                id: 'playlist-2',
                name: 'Other portal',
                serverUrl: 'https://other.example.com',
            };
            let answer!: (value: unknown) => void;
            apiService.getAccountInfo.mockReturnValue(
                new Promise((resolve) => {
                    answer = resolve;
                })
            );

            const pending = store.checkPortalStatus();
            store.setCurrentPlaylist(other);
            answer({
                user_info: { auth: 1, exp_date: '0', status: 'Active' },
                server_info: { timezone: 'Europe/London' },
            });

            // The answer describes A; callers gating content init on the
            // result get the store's verdict about B instead.
            await expect(pending).resolves.toBe('unavailable');
            expect(store.currentPlaylist()).toEqual(other);
            expect(store.portalStatus()).toBe('unavailable');
            expect(rememberServerTimezone).toHaveBeenCalledWith(
                PLAYLIST.id,
                PLAYLIST_CONNECTION,
                'Europe/London'
            );
        });

        it('does not patch the store with a late answer when the playlist was edited in place meanwhile', async () => {
            let answer!: (value: unknown) => void;
            apiService.getAccountInfo.mockReturnValue(
                new Promise((resolve) => {
                    answer = resolve;
                })
            );

            const pending = store.checkPortalStatus();
            // Same id, new panel: the in-place edit flow.
            const moved: XtreamPlaylistData = {
                ...PLAYLIST,
                serverUrl: 'https://moved.example.com',
            };
            store.setCurrentPlaylist(moved);
            answer({
                user_info: { auth: 1, exp_date: '0', status: 'Active' },
                server_info: { timezone: 'Europe/London' },
            });

            await expect(pending).resolves.toBe('unavailable');
            expect(store.currentPlaylist()).toEqual(moved);
            expect(store.portalStatus()).toBe('unavailable');
            // The row-level guard belongs to the data source, which only
            // ever sees the ORIGINAL connection the answer came from.
            expect(rememberServerTimezone).toHaveBeenCalledWith(
                PLAYLIST.id,
                PLAYLIST_CONNECTION,
                'Europe/London'
            );
        });

        it('does not mark a playlist selected meanwhile unavailable for the earlier playlist’s failure', async () => {
            const other: XtreamPlaylistData = { ...PLAYLIST, id: 'playlist-2' };
            let fail!: (reason: unknown) => void;
            apiService.getAccountInfo.mockReturnValue(
                new Promise((_resolve, reject) => {
                    fail = reject;
                })
            );

            const pending = store.checkPortalStatus();
            store.setCurrentPlaylist(other);
            respondWith({ timezone: 'UTC' });
            await store.checkPortalStatus();
            expect(store.portalStatus()).toBe('active');

            fail(new Error('panel down'));

            // A's failure says nothing about B, so the caller gets B's verdict.
            await expect(pending).resolves.toBe('active');
            expect(store.portalStatus()).toBe('active');
        });

        it('still reports the portal status and retries on the next check when the data source rejects', async () => {
            rememberServerTimezone.mockRejectedValueOnce(
                new Error('storage unavailable')
            );
            respondWith({ timezone: 'Europe/London' });

            await expect(store.checkPortalStatus()).resolves.toBe('active');
            expect(store.currentPlaylist()?.serverTimezone).toBe(
                'Europe/London'
            );

            await store.checkPortalStatus();

            expect(rememberServerTimezone).toHaveBeenCalledTimes(2);
        });
    });
});
