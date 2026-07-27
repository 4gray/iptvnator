import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { STALKER_RECIPE_CLASSIFIER_VERSION } from '@iptvnator/portal/stalker/protocol';
import { DataService, RuntimeCapabilitiesService } from '@iptvnator/services';
import { PlaylistMeta, STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { withStalkerPortal } from './with-stalker-portal.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
    }),
}));

const TestPortalStore = signalStore(withStalkerPortal());

const PLAYLIST = {
    _id: 'stalker-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-05-22T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    isFullStalkerPortal: false,
} as PlaylistMeta;

describe('withStalkerPortal', () => {
    let store: InstanceType<typeof TestPortalStore>;
    let dbCreatePlaylist: jest.Mock;
    let dbGetPlaylist: jest.Mock;
    let runtime: {
        supportsStalkerPlaylistSqliteSync: boolean;
    };
    let dataService: {
        sendIpcEvent: jest.Mock;
    };
    let stalkerSession: {
        ensureToken: jest.Mock;
        setActiveWatchdogPlaylist: jest.Mock;
        supportsTypedSessions: jest.Mock;
        makeAuthenticatedRequest: jest.Mock;
    };

    beforeEach(() => {
        dbCreatePlaylist = jest.fn().mockResolvedValue(undefined);
        dbGetPlaylist = jest.fn().mockResolvedValue(null);
        Object.defineProperty(window, 'electron', {
            value: {
                dbCreatePlaylist,
                dbGetPlaylist,
            } as Window['electron'],
            configurable: true,
        });

        runtime = {
            supportsStalkerPlaylistSqliteSync: true,
        };
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        stalkerSession = {
            ensureToken: jest.fn(),
            setActiveWatchdogPlaylist: jest.fn(),
            supportsTypedSessions: jest.fn().mockReturnValue(true),
            makeAuthenticatedRequest: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                TestPortalStore,
                {
                    provide: DataService,
                    useValue: dataService,
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
                {
                    provide: StalkerSessionService,
                    useValue: stalkerSession,
                },
            ],
        });

        store = TestBed.inject(TestPortalStore);
    });

    it('creates the SQLite playlist row when the runtime exposes the required bridge methods', async () => {
        await store.setCurrentPlaylist(PLAYLIST);

        expect(dbGetPlaylist).toHaveBeenCalledWith('stalker-1');
        expect(dbCreatePlaylist).toHaveBeenCalledWith({
            id: 'stalker-1',
            name: 'Demo Stalker',
            macAddress: '00:1A:79:00:00:01',
            url: 'http://demo.example/stalker_portal/server/load.php',
            type: 'stalker',
        });
        expect(stalkerSession.setActiveWatchdogPlaylist).not.toHaveBeenCalled();
    });

    it('does not touch SQLite when the Electron bridge is partial', async () => {
        runtime.supportsStalkerPlaylistSqliteSync = false;

        await store.setCurrentPlaylist(PLAYLIST);

        expect(dbGetPlaylist).not.toHaveBeenCalled();
        expect(dbCreatePlaylist).not.toHaveBeenCalled();
    });

    it('sends Stalker requests through DataService without requiring the SQLite bridge', async () => {
        dataService.sendIpcEvent.mockResolvedValue({ js: { data: [] } });

        await store.makeStalkerRequest(PLAYLIST, { action: 'get_profile' });

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(STALKER_REQUEST, {
            macAddress: '00:1A:79:00:00:01',
            params: { action: 'get_profile' },
            url: 'http://demo.example/stalker_portal/server/load.php',
        });
        expect(stalkerSession.ensureToken).not.toHaveBeenCalled();
        expect(stalkerSession.makeAuthenticatedRequest).not.toHaveBeenCalled();
    });

    it('routes a full portal request through the typed session facade', async () => {
        const fullPlaylist = {
            ...PLAYLIST,
            isFullStalkerPortal: true,
            stalkerRecipeClassifierVersion: STALKER_RECIPE_CLASSIFIER_VERSION,
            stalkerRequestRecipe: 'full-session' as const,
        };
        const response = { js: [{ id: 'vod' }] };
        stalkerSession.makeAuthenticatedRequest.mockResolvedValue(response);

        await expect(
            store.makeStalkerRequest(fullPlaylist, {
                action: 'get_categories',
                type: 'vod',
            })
        ).resolves.toBe(response);

        expect(stalkerSession.makeAuthenticatedRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                ...fullPlaylist,
                lastUsage: '',
            }),
            {
                action: 'get_categories',
                type: 'vod',
            }
        );
        expect(stalkerSession.ensureToken).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });
});
