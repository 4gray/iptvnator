import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    DataService,
    PlaylistsService,
    SettingsStore,
} from '@iptvnator/services';
import { STALKER_REQUEST, type Playlist } from '@iptvnator/shared/interfaces';
import { StalkerContentSeedService } from './stalker-content-seed.service';
import { StalkerItvCacheService } from './stalker-itv-cache.service';
import { StalkerPortalDiscoveryService } from './stalker-portal-discovery.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { StalkerSessionService } from './stalker-session.service';

describe('StalkerContentSeedService', () => {
    let dataService: { sendIpcEvent: jest.Mock };
    let session: {
        ensureToken: jest.Mock;
        makeAuthenticatedRequest: jest.Mock;
        adoptDiscoveredSession: jest.Mock;
    };
    let itvCache: { ensureLoaded: jest.Mock };
    let settingsStore: { disableVod: jest.Mock };
    let discovery: { discover: jest.Mock };
    let playlists: { transformPlaylistMeta: jest.Mock };
    let seeder: StalkerContentSeedService;

    function stalkerPlaylist(scope: Partial<Playlist> = {}): Playlist {
        return {
            _id: 'playlist-1',
            title: 'Panel',
            portalUrl: 'http://panel.example/c',
            macAddress: '00:1A:79:00:00:01',
            ...scope,
        } as Playlist;
    }

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest
                .fn()
                .mockResolvedValue({ js: { data: [{ id: '1' }] } }),
        };
        session = {
            ensureToken: jest.fn().mockResolvedValue({ token: 't' }),
            makeAuthenticatedRequest: jest
                .fn()
                .mockResolvedValue({ js: { data: [{ id: '1' }] } }),
            adoptDiscoveredSession: jest.fn(),
        };
        itvCache = { ensureLoaded: jest.fn().mockResolvedValue(undefined) };
        settingsStore = { disableVod: jest.fn(() => false) };
        // Default: the panel answers where the row says it is, without a
        // handshake — the shape the pre-discovery rows already had.
        discovery = {
            discover: jest.fn().mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://panel.example/c',
                isFullStalkerPortal: false,
            }),
        };
        playlists = {
            transformPlaylistMeta: jest.fn(() => of(null)),
        };
        TestBed.configureTestingModule({
            providers: [
                StalkerContentSeedService,
                { provide: DataService, useValue: dataService },
                { provide: StalkerSessionService, useValue: session },
                { provide: StalkerItvCacheService, useValue: itvCache },
                { provide: SettingsStore, useValue: settingsStore },
                { provide: StalkerPortalDiscoveryService, useValue: discovery },
                { provide: PlaylistsService, useValue: playlists },
                {
                    provide: StalkerPortalRepairService,
                    useValue: {
                        waitForPendingRepair: jest.fn(),
                        applyOverride: jest.fn(
                            <T extends { _id?: string }>(playlist: T) =>
                                playlist
                        ),
                        shouldAttemptRepair: jest.fn(() => false),
                        repairPortal: jest.fn(),
                    },
                },
            ],
        });
        seeder = TestBed.inject(StalkerContentSeedService);
    });

    afterEach(() => TestBed.resetTestingModule());

    it('validates the portal with one live page and warms the channel list', async () => {
        const playlist = stalkerPlaylist();

        await seeder.seed(playlist);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            STALKER_REQUEST,
            expect.objectContaining({
                url: 'http://panel.example/c',
                macAddress: '00:1A:79:00:00:01',
                params: expect.objectContaining({
                    action: 'get_ordered_list',
                    type: 'itv',
                    p: 1,
                }),
            })
        );
        // Background warm, so a slow crawl cannot spend the row's budget.
        // Called with the resolved row discovery handed back.
        expect(itvCache.ensureLoaded).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'playlist-1',
                portalUrl: 'http://panel.example/c',
            })
        );
        expect(await seeder.seed(playlist)).toEqual(
            expect.objectContaining({ _id: 'playlist-1' })
        );
    });

    it('rejects a portal that answers without live channels', async () => {
        dataService.sendIpcEvent.mockResolvedValueOnce({ js: { data: [] } });

        await expect(seeder.seed(stalkerPlaylist())).rejects.toThrow(
            'no live channels'
        );
        expect(itvCache.ensureLoaded).not.toHaveBeenCalled();
    });

    it('rejects an unreadable portal so the bulk import skips it', async () => {
        dataService.sendIpcEvent.mockRejectedValueOnce(
            new Error('portal down')
        );

        await expect(seeder.seed(stalkerPlaylist())).rejects.toThrow(
            'portal down'
        );
        expect(itvCache.ensureLoaded).not.toHaveBeenCalled();
    });

    it('validates a VOD-only row with its category list instead of live', async () => {
        dataService.sendIpcEvent.mockResolvedValueOnce({
            js: [{ id: '1', title: 'Movies' }],
        });

        await seeder.seed(
            stalkerPlaylist({ importLive: false, importVod: true })
        );

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            STALKER_REQUEST,
            expect.objectContaining({
                params: expect.objectContaining({
                    action: 'get_categories',
                    type: 'vod',
                }),
            })
        );
        expect(itvCache.ensureLoaded).not.toHaveBeenCalled();
    });

    it('leaves a row without a portal or MAC unseeded', async () => {
        await seeder.seed(stalkerPlaylist({ macAddress: '' }));
        await seeder.seed(stalkerPlaylist({ portalUrl: '' }));

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(discovery.discover).not.toHaveBeenCalled();
    });

    it('seeds the endpoint discovery resolved for a pasted list URL', async () => {
        discovery.discover.mockResolvedValue({
            status: 'resolved',
            portalUrl: 'http://panel.example/portal.php',
            isFullStalkerPortal: true,
            token: 'token-1',
            watchdogTimeoutSeconds: 300,
            timeslotSeconds: 15,
            accountInfo: { login: 'acct', expire_date: '2030-01-01' },
        });

        const seeded = await seeder.seed(stalkerPlaylist());

        // The row is a provider list line: `http://panel/c` is the portal
        // PAGE, so the catalog call must go to the API discovery proved.
        expect(discovery.discover).toHaveBeenCalledWith(
            'http://panel.example/c',
            '00:1A:79:00:00:01',
            expect.anything(),
            expect.objectContaining({
                credentials: { username: '', password: '' },
            })
        );
        expect(session.makeAuthenticatedRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                portalUrl: 'http://panel.example/portal.php',
                isFullStalkerPortal: true,
            }),
            expect.objectContaining({ action: 'get_ordered_list', p: 1 })
        );
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        // The session the classification handshake negotiated is adopted, so
        // the seed request does not handshake a second time.
        expect(session.adoptDiscoveredSession).toHaveBeenCalledWith(
            'playlist-1',
            expect.objectContaining({
                portalUrl: 'http://panel.example/portal.php',
            }),
            expect.objectContaining({
                token: 'token-1',
                watchdogTimeoutSeconds: 300,
                timeslotSeconds: 15,
            })
        );
        // Persisted, or the source breaks again on the next start.
        expect(playlists.transformPlaylistMeta).toHaveBeenCalledWith(
            'playlist-1',
            expect.any(Function)
        );
        const transform = playlists.transformPlaylistMeta.mock.calls[0][1];
        expect(
            transform({
                _id: 'playlist-1',
                macAddress: '00:1A:79:00:00:01',
                portalUrl: 'http://panel.example/c',
            })
        ).toEqual(
            expect.objectContaining({
                portalUrl: 'http://panel.example/portal.php',
                isFullStalkerPortal: true,
                stalkerToken: 'token-1',
                stalkerWatchdogTimeout: 300,
                stalkerTimeslot: 15,
            })
        );
        expect(seeded).toEqual(
            expect.objectContaining({
                portalUrl: 'http://panel.example/portal.php',
                isFullStalkerPortal: true,
                stalkerToken: 'token-1',
            })
        );
        expect(itvCache.ensureLoaded).toHaveBeenCalledWith(
            expect.objectContaining({
                portalUrl: 'http://panel.example/portal.php',
            })
        );
    });

    it('keeps a row that already carries an observed mode untouched', async () => {
        await seeder.seed(
            stalkerPlaylist({
                portalUrl: 'http://panel.example/portal.php',
                isFullStalkerPortal: false,
            })
        );

        expect(discovery.discover).not.toHaveBeenCalled();
        expect(playlists.transformPlaylistMeta).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            STALKER_REQUEST,
            expect.objectContaining({ url: 'http://panel.example/portal.php' })
        );
    });

    it('rejects a row discovery cannot reach', async () => {
        discovery.discover.mockResolvedValue({ status: 'unreachable' });

        await expect(seeder.seed(stalkerPlaylist())).rejects.toThrow(
            'did not answer as a Stalker portal'
        );
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(playlists.transformPlaylistMeta).not.toHaveBeenCalled();
    });

    it('rejects a row whose portal refuses the account', async () => {
        discovery.discover.mockResolvedValue({
            status: 'auth-rejected',
            portalUrl: 'http://panel.example/portal.php',
            error: new Error('blocked'),
        });

        await expect(seeder.seed(stalkerPlaylist())).rejects.toThrow(
            'refused the account'
        );
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(session.adoptDiscoveredSession).not.toHaveBeenCalled();
    });
});
