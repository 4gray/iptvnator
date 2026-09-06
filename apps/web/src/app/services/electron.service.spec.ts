import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DialogService } from '@iptvnator/ui/components';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { SettingsStore } from '@iptvnator/services';
import {
    AUTO_UPDATE_PLAYLISTS,
    AutoUpdatePlaylistOutcome,
    AutoUpdatePlaylistStatus,
    AutoUpdatePlaylistsResult,
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    PLAYLIST_PARSE_BY_URL,
    Playlist,
    SECURITY_ERROR_PREFIX,
} from '@iptvnator/shared/interfaces';
import { ElectronService } from './electron.service';

describe('ElectronService', () => {
    const session = { id: 'session-1' };
    let electronBridge: {
        autoUpdatePlaylists: jest.Mock;
        fetchPlaylistByUrl: jest.Mock;
        onPlayerError: jest.Mock;
        openInMpv: jest.Mock;
        openInVlc: jest.Mock;
    };
    let snackBar: { open: jest.Mock };
    let store: { dispatch: jest.Mock };
    let translateService: { instant: jest.Mock };
    let service: ElectronService;

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        electronBridge = {
            autoUpdatePlaylists: jest.fn(),
            fetchPlaylistByUrl: jest.fn(),
            onPlayerError: jest.fn(),
            openInMpv: jest.fn().mockResolvedValue(session),
            openInVlc: jest.fn().mockResolvedValue(session),
        };
        snackBar = {
            open: jest.fn(() => ({
                onAction: () => of(undefined),
            })),
        };
        store = { dispatch: jest.fn() };
        translateService = { instant: jest.fn((key: string) => key) };

        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: electronBridge,
        });

        TestBed.configureTestingModule({
            providers: [
                ElectronService,
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: DialogService,
                    useValue: {
                        openConfirmDialog: jest.fn(),
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        getTrustOptions: jest.fn(() => ({
                            trustedPrivateNetworkEpgUrls: [],
                            trustedInsecureTlsHosts: [],
                        })),
                        getSettings: jest.fn(() => ({
                            trustedInsecureTlsHosts: [],
                        })),
                        updateSettings: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    provide: Store,
                    useValue: store,
                },
                {
                    provide: TranslateService,
                    useValue: translateService,
                },
            ],
        });

        service = TestBed.inject(ElectronService);
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: undefined,
        });
        jest.restoreAllMocks();
    });

    it('ignores URL imports without a payload instead of calling the Electron bridge', async () => {
        await service.sendIpcEvent(PLAYLIST_PARSE_BY_URL);

        expect(electronBridge.fetchPlaylistByUrl).not.toHaveBeenCalled();
    });

    it('forwards URL import User-Agent alongside trust options and dispatches the persisted value', async () => {
        const playlist = {
            _id: 'ua-playlist',
            userAgent: 'IPTVnator-Test/1.0',
        };
        electronBridge.fetchPlaylistByUrl.mockResolvedValue(playlist);
        service.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            url: 'https://example.test/list.m3u',
            userAgent: playlist.userAgent,
        });
        await Promise.resolve();
        expect(electronBridge.fetchPlaylistByUrl).toHaveBeenCalledWith(
            'https://example.test/list.m3u',
            undefined,
            {
                trustedPrivateNetworkEpgUrls: [],
                trustedInsecureTlsHosts: [],
                userAgent: playlist.userAgent,
            }
        );
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.handleAddingPlaylistByUrl({
                isTemporary: false,
                playlist: playlist as Playlist,
            })
        );
    });

    it('redacts credentials from backend player errors before logging', () => {
        const secret = 'player-error-token-secret';
        const listener = electronBridge.onPlayerError.mock.calls[0][0];

        listener({
            player: 'MPV',
            error: 'Playback failed',
            originalError: `Request failed: token=${secret}&channel=news`,
        });

        const output = JSON.stringify((console.error as jest.Mock).mock.calls);
        expect(output).not.toContain(secret);
        expect(output).toContain('channel=news');
    });

    it('shows the trust-host action for Electron-wrapped security errors', async () => {
        const securityPayload = {
            code: ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate,
            host: 'playlist.local',
            message: 'Certificate for this playlist host is invalid.',
        };
        electronBridge.fetchPlaylistByUrl.mockRejectedValue(
            new Error(
                `Error invoking remote method 'FETCH_PLAYLIST_BY_URL': Error: ${SECURITY_ERROR_PREFIX}${JSON.stringify(
                    securityPayload
                )}`
            )
        );

        await service.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            url: 'https://playlist.local/list.m3u',
        });
        await Promise.resolve();

        expect(snackBar.open).toHaveBeenCalledWith(
            'Certificate for this playlist host is invalid.',
            'Trust host',
            { duration: 10000 }
        );
    });

    it('preserves an absent MPV user-agent so backend fallback headers can apply', async () => {
        await service.sendIpcEvent('OPEN_MPV_PLAYER', {
            url: 'https://example.test/live.m3u8',
            headers: {
                'User-Agent': 'FallbackAgent/1.0',
            },
        });

        expect(electronBridge.openInMpv).toHaveBeenCalledWith(
            'https://example.test/live.m3u8',
            '',
            '',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
                'User-Agent': 'FallbackAgent/1.0',
            }
        );
    });

    it('preserves an absent VLC user-agent so backend fallback headers can apply', async () => {
        await service.sendIpcEvent('OPEN_VLC_PLAYER', {
            url: 'https://example.test/live.m3u8',
            headers: {
                'User-Agent': 'FallbackAgent/1.0',
            },
        });

        expect(electronBridge.openInVlc).toHaveBeenCalledWith(
            'https://example.test/live.m3u8',
            '',
            '',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
                'User-Agent': 'FallbackAgent/1.0',
            }
        );
    });

    describe('startup playlist auto-refresh feedback', () => {
        function createPlaylist(id: string, title: string): Playlist {
            return {
                _id: id,
                autoRefresh: true,
                count: 1,
                importDate: '2026-07-01T00:00:00.000Z',
                lastUsage: '2026-07-01T00:00:00.000Z',
                title,
            };
        }

        function outcome(
            playlistId: string,
            title: string,
            status: AutoUpdatePlaylistStatus
        ): AutoUpdatePlaylistOutcome {
            return { playlistId, status, title };
        }

        async function runAutoUpdate(
            result: AutoUpdatePlaylistsResult
        ): Promise<void> {
            electronBridge.autoUpdatePlaylists.mockResolvedValue(result);

            await service.sendIpcEvent(
                AUTO_UPDATE_PLAYLISTS,
                result.outcomes.map((entry) =>
                    createPlaylist(entry.playlistId, entry.title)
                )
            );
        }

        it('reports success only when every requested playlist was refreshed', async () => {
            const refreshed = [
                createPlaylist('first', 'First'),
                createPlaylist('second', 'Second'),
            ];

            await runAutoUpdate({
                playlists: refreshed,
                outcomes: [
                    outcome('first', 'First', 'updated'),
                    outcome('second', 'Second', 'updated'),
                ],
            });

            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updateManyPlaylists({ playlists: refreshed })
            );
            expect(translateService.instant).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_SUCCESS',
                { total: 2, updated: 2, failed: 0, skipped: 0 }
            );
            expect(snackBar.open).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_SUCCESS',
                undefined,
                { duration: 2000 }
            );
        });

        it('says the refresh was incomplete when only some playlists updated', async () => {
            const refreshed = [createPlaylist('reachable', 'Reachable')];

            await runAutoUpdate({
                playlists: refreshed,
                outcomes: [
                    outcome('reachable', 'Reachable', 'updated'),
                    outcome('unreachable', 'Unreachable', 'failed'),
                ],
            });

            // Only the successfully refreshed playlists reach the store.
            expect(store.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updateManyPlaylists({ playlists: refreshed })
            );
            expect(translateService.instant).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_PARTIAL',
                { total: 2, updated: 1, failed: 1, skipped: 0 }
            );
            expect(snackBar.open).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_PARTIAL',
                'CLOSE',
                { duration: 6000, panelClass: ['error-snackbar'] }
            );
            expect(
                JSON.stringify((console.warn as jest.Mock).mock.calls)
            ).toContain('Unreachable (failed)');
        });

        it('accounts for skipped playlists in a batch that also failed', async () => {
            await runAutoUpdate({
                playlists: [createPlaylist('reachable', 'Reachable')],
                outcomes: [
                    outcome('reachable', 'Reachable', 'updated'),
                    outcome('unreachable', 'Unreachable', 'failed'),
                    outcome('sourceless', 'Sourceless', 'skipped'),
                ],
            });

            // The plain partial message only names updated/total/failed, which
            // would leave the skipped playlist unexplained.
            expect(translateService.instant).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_PARTIAL_WITH_SKIPPED',
                { total: 3, updated: 1, failed: 1, skipped: 1 }
            );
            expect(snackBar.open).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_PARTIAL_WITH_SKIPPED',
                'CLOSE',
                { duration: 6000, panelClass: ['error-snackbar'] }
            );
        });

        it('reports a full failure when no playlist could be refreshed', async () => {
            await runAutoUpdate({
                playlists: [],
                outcomes: [
                    outcome('first', 'First', 'failed'),
                    outcome('second', 'Second', 'failed'),
                ],
            });

            expect(translateService.instant).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_FAILED',
                { total: 2, updated: 0, failed: 2, skipped: 0 }
            );
            expect(snackBar.open).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_FAILED',
                'CLOSE',
                { duration: 6000, panelClass: ['error-snackbar'] }
            );
        });

        it('distinguishes playlists skipped for a missing source from failures', async () => {
            await runAutoUpdate({
                playlists: [createPlaylist('reachable', 'Reachable')],
                outcomes: [
                    outcome('reachable', 'Reachable', 'updated'),
                    outcome('sourceless', 'Sourceless', 'skipped'),
                ],
            });

            expect(translateService.instant).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_SKIPPED',
                { total: 2, updated: 1, failed: 0, skipped: 1 }
            );
            expect(snackBar.open).toHaveBeenCalledWith(
                'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_SKIPPED',
                undefined,
                { duration: 2000 }
            );
        });
    });
});
