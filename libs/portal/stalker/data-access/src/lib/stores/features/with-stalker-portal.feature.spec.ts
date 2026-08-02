import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { DataService, RuntimeCapabilitiesService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerPortalRepairService } from '../../stalker-portal-repair.service';
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
    let stalkerSession: {
        ensureToken: jest.Mock;
        setActiveWatchdogPlaylist: jest.Mock;
    };
    let applyOverride: jest.Mock;

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
        stalkerSession = {
            ensureToken: jest.fn(),
            setActiveWatchdogPlaylist: jest.fn(),
        };
        applyOverride = jest.fn((playlist) => playlist);

        TestBed.configureTestingModule({
            providers: [
                TestPortalStore,
                {
                    provide: DataService,
                    useValue: {
                        sendIpcEvent: jest.fn(),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
                {
                    provide: StalkerSessionService,
                    useValue: stalkerSession,
                },
                {
                    provide: StalkerPortalRepairService,
                    useValue: { applyOverride },
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
        expect(stalkerSession.setActiveWatchdogPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                macAddress: '00:1A:79:00:00:01',
                portalUrl: 'http://demo.example/stalker_portal/server/load.php',
            })
        );
    });

    it('hands the repaired configuration to the watchdog and store on activation', async () => {
        // Route re-activation passes the stale NgRx meta; the repair
        // override must win here, or reopening the portal would stop or
        // repoint the repaired keepalive back to the broken configuration.
        const repaired = {
            ...PLAYLIST,
            portalUrl: 'http://demo.example/server/load.php',
            isFullStalkerPortal: true,
        };
        applyOverride.mockReturnValue(repaired);

        await store.setCurrentPlaylist(PLAYLIST);

        expect(applyOverride).toHaveBeenCalledWith(PLAYLIST);
        expect(stalkerSession.setActiveWatchdogPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                portalUrl: 'http://demo.example/server/load.php',
                isFullStalkerPortal: true,
            })
        );
        expect(store.currentPlaylist()).toEqual(repaired);
    });

    it('does not touch SQLite when the Electron bridge is partial', async () => {
        runtime.supportsStalkerPlaylistSqliteSync = false;

        await store.setCurrentPlaylist(PLAYLIST);

        expect(dbGetPlaylist).not.toHaveBeenCalled();
        expect(dbCreatePlaylist).not.toHaveBeenCalled();
    });

});
