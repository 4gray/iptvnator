import { TestBed } from '@angular/core/testing';
import { PlaylistsService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { signalStore } from '@ngrx/signals';
import { of } from 'rxjs';
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

// 2026-09-06 19:30:00 UTC
const SERVER_EPOCH = 1_788_723_000;

const TestPortalStore = signalStore(withPortal());

describe('withPortal', () => {
    let store: InstanceType<typeof TestPortalStore>;
    let apiService: {
        getAccountInfo: jest.Mock;
    };
    let storedPlaylist: Playlist;
    let transformPlaylistMeta: jest.Mock;

    beforeEach(() => {
        apiService = {
            getAccountInfo: jest.fn(),
        };
        storedPlaylist = {
            _id: PLAYLIST.id,
            title: PLAYLIST.name,
            serverUrl: PLAYLIST.serverUrl,
            username: PLAYLIST.username,
            password: PLAYLIST.password,
        } as Playlist;
        // Mirrors the real service: the transform receives the stored row
        // and `null` means "nothing to write".
        transformPlaylistMeta = jest.fn(
            (
                _playlistId: string,
                transform: (current: Playlist) => Playlist | null
            ) => {
                const next = transform(storedPlaylist);
                if (next) {
                    storedPlaylist = next;
                }
                return of(next);
            }
        );

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
                {
                    provide: PlaylistsService,
                    useValue: { transformPlaylistMeta },
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
        it('keeps the learned IANA timezone in the store AND on the stored row', async () => {
            respondWith({ timezone: 'Europe/London' });

            await store.checkPortalStatus();

            expect(store.currentPlaylist()?.serverTimezone).toBe(
                'Europe/London'
            );
            expect(transformPlaylistMeta).toHaveBeenCalledWith(
                PLAYLIST.id,
                expect.any(Function)
            );
            expect(storedPlaylist.serverTimezone).toBe('Europe/London');
        });

        it('derives a fixed offset from the panel clock when the timezone name is unusable', async () => {
            respondWith({
                timezone: 'UTC+3',
                time_now: '2026-09-06 22:30:00',
                timestamp_now: SERVER_EPOCH,
            });

            await store.checkPortalStatus();

            expect(store.currentPlaylist()?.serverTimezone).toBe('UTC+03:00');
            expect(storedPlaylist.serverTimezone).toBe('UTC+03:00');
        });

        it('does not rewrite the row when it already carries the value', async () => {
            storedPlaylist = { ...storedPlaylist, serverTimezone: 'UTC' };
            store.setCurrentPlaylist({ ...PLAYLIST, serverTimezone: 'UTC' });
            respondWith({ timezone: 'UTC' });

            await store.checkPortalStatus();

            expect(transformPlaylistMeta).not.toHaveBeenCalled();
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
            expect(transformPlaylistMeta).not.toHaveBeenCalled();
        });

        it('persists a late answer under the playlist that asked, never onto the one selected meanwhile', async () => {
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

            await expect(pending).resolves.toBe('active');
            expect(store.currentPlaylist()).toEqual(other);
            expect(store.portalStatus()).toBe('unavailable');
            expect(transformPlaylistMeta).toHaveBeenCalledWith(
                PLAYLIST.id,
                expect.any(Function)
            );
            expect(storedPlaylist.serverTimezone).toBe('Europe/London');
        });

        it('does not persist a late answer onto a row whose connection was edited meanwhile', async () => {
            let answer!: (value: unknown) => void;
            apiService.getAccountInfo.mockReturnValue(
                new Promise((resolve) => {
                    answer = resolve;
                })
            );

            const pending = store.checkPortalStatus();
            // The edit flow moved the source (and dropped the old clock)
            // while the old panel's answer was still on the wire.
            storedPlaylist = {
                ...storedPlaylist,
                serverUrl: 'https://moved.example.com',
                serverTimezone: undefined,
            };
            answer({
                user_info: { auth: 1, exp_date: '0', status: 'Active' },
                server_info: { timezone: 'Europe/London' },
            });

            await expect(pending).resolves.toBe('active');
            expect(transformPlaylistMeta).toHaveBeenCalledTimes(1);
            expect(storedPlaylist.serverTimezone).toBeUndefined();
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

            await expect(pending).resolves.toBe('unavailable');
            expect(store.portalStatus()).toBe('active');
        });

        it('still reports the portal status when persisting the timezone fails', async () => {
            transformPlaylistMeta.mockImplementation(() => {
                throw new Error('storage unavailable');
            });
            respondWith({ timezone: 'Europe/London' });

            await expect(store.checkPortalStatus()).resolves.toBe('active');
            expect(store.currentPlaylist()?.serverTimezone).toBe(
                'Europe/London'
            );
        });
    });
});
