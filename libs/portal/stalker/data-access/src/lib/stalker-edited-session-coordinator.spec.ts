import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DataService, PlaylistsService } from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from './stalker-session.service';

describe('Stalker edited-session coordination', () => {
    const oldPlaylist = {
        _id: 'portal-edit',
        title: 'Portal',
        portalUrl: 'https://old.example.com/server/load.php',
        macAddress: '00:1A:79:AA:BB:CC',
        isFullStalkerPortal: true,
        lastUsage: '',
    } as Playlist;

    let authenticate: jest.SpyInstance;
    let resolveOldAuthentication: (
        value: Awaited<ReturnType<StalkerSessionService['authenticate']>>
    ) => void = () => undefined;
    let service: StalkerSessionService;
    let updatePlaylistMeta: jest.Mock;
    let updateStalkerSession: jest.Mock;

    beforeEach(() => {
        updatePlaylistMeta = jest.fn(() => of(oldPlaylist));
        updateStalkerSession = jest.fn(() => of(oldPlaylist));
        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                {
                    provide: DataService,
                    useValue: { sendIpcEvent: jest.fn() },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: jest.fn(() => of(oldPlaylist)),
                        updatePlaylistMeta,
                        updateStalkerSession,
                    },
                },
            ],
        });
        service = TestBed.inject(StalkerSessionService);
        authenticate = jest.spyOn(service, 'authenticate').mockReturnValueOnce(
            new Promise((resolve) => {
                resolveOldAuthentication = resolve;
            })
        );
    });

    it('prevents late pre-edit auth from replacing a resolved full session', async () => {
        const oldAuthentication = service.ensureToken(oldPlaylist);
        while (authenticate.mock.calls.length === 0) {
            await Promise.resolve();
        }
        const editedPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://new.example.com/server/load.php',
            stalkerToken: 'NEW_TOKEN',
            stalkerSessionIdentity: 'new-fingerprint',
            stalkerWatchdogTimeout: 90,
            stalkerTimeslot: 5,
        };
        const replacement = service.replaceSessionAfterEdit(editedPlaylist);

        resolveOldAuthentication({ token: 'OLD_TOKEN' });

        await expect(oldAuthentication).rejects.toThrow(/stale/i);
        await replacement;
        expect(service.getCachedToken(oldPlaylist._id)).toBe('NEW_TOKEN');
        expect(updatePlaylistMeta).toHaveBeenLastCalledWith(
            expect.objectContaining({
                portalUrl: 'https://new.example.com/server/load.php',
                stalkerSessionPatch: expect.objectContaining({
                    stalkerToken: 'NEW_TOKEN',
                }),
            })
        );
        expect(updateStalkerSession).not.toHaveBeenCalled();
    });

    it('fences and drains pre-edit authentication before discovery may start', async () => {
        const oldAuthentication = service.ensureToken(oldPlaylist);
        while (authenticate.mock.calls.length === 0) {
            await Promise.resolve();
        }
        const editedPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://new.example.com/server/load.php',
        };

        let fenceSettled = false;
        const fencePromise = service
            .beginEditDiscovery(editedPlaylist)
            .then((fence) => {
                fenceSettled = true;
                return fence;
            });
        await Promise.resolve();
        expect(fenceSettled).toBe(false);

        resolveOldAuthentication({ token: 'OLD_TOKEN' });

        await expect(oldAuthentication).rejects.toThrow(/stale/i);
        const fence = await fencePromise;
        service.cancelEditDiscovery(fence);
    });

    it('prevents late pre-edit auth from restoring a cleared simple session', async () => {
        const oldAuthentication = service.ensureToken(oldPlaylist);
        while (authenticate.mock.calls.length === 0) {
            await Promise.resolve();
        }
        const editedPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://new.example.com/portal.php',
            isFullStalkerPortal: false,
            stalkerToken: undefined,
            stalkerSessionIdentity: undefined,
            stalkerWatchdogTimeout: undefined,
            stalkerTimeslot: undefined,
        };
        const replacement = service.replaceSessionAfterEdit(editedPlaylist);

        resolveOldAuthentication({ token: 'OLD_TOKEN' });

        await expect(oldAuthentication).rejects.toThrow(/stale/i);
        await replacement;
        expect(service.getCachedToken(oldPlaylist._id)).toBeNull();
        expect(updatePlaylistMeta).toHaveBeenLastCalledWith(
            expect.objectContaining({
                _id: oldPlaylist._id,
                stalkerSessionPatch: null,
            })
        );
    });

    it('persists a resolved full connection and session in one metadata write', async () => {
        const editedPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://new.example.com/server/load.php',
            username: 'subscriber',
            stalkerToken: 'NEW_TOKEN',
            stalkerSessionIdentity: 'new-fingerprint',
            stalkerWatchdogTimeout: 90,
            stalkerTimeslot: 5,
        };

        await service.replaceSessionAfterEdit(editedPlaylist);

        expect(updatePlaylistMeta).toHaveBeenCalledWith(
            expect.objectContaining({
                portalUrl: 'https://new.example.com/server/load.php',
                username: 'subscriber',
                stalkerSessionPatch: {
                    stalkerToken: 'NEW_TOKEN',
                    stalkerSessionIdentity: expect.any(String),
                    stalkerWatchdogTimeout: 90,
                    stalkerTimeslot: 5,
                    stalkerAccountInfo: undefined,
                },
            })
        );
        expect(updateStalkerSession).not.toHaveBeenCalled();
    });

    it('does not adopt a resolved full session when its atomic write fails', async () => {
        service.adoptDiscoveredSimplePortal(oldPlaylist);
        updatePlaylistMeta.mockReturnValueOnce(
            throwError(() => new Error('write failed'))
        );
        const editedPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://new.example.com/server/load.php',
            stalkerToken: 'NEW_TOKEN',
            stalkerSessionIdentity: 'new-fingerprint',
        };

        await expect(
            service.replaceSessionAfterEdit(editedPlaylist)
        ).rejects.toThrow('write failed');

        expect(service.getCachedToken(oldPlaylist._id)).toBeNull();

        // A failed edit must release its pending authority as well: the
        // still-persisted connection remains usable without an app restart.
        service.setCachedToken(oldPlaylist._id, 'OLD_TOKEN', oldPlaylist);
        await expect(service.ensureToken(oldPlaylist)).resolves.toEqual({
            token: 'OLD_TOKEN',
            serialNumber: undefined,
        });
    });

    it('rebases stale authority when a restored persisted row owns the playlist id', async () => {
        const editedPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://new.example.com/server/load.php',
            stalkerToken: 'NEW_TOKEN',
        };
        await service.replaceSessionAfterEdit(editedPlaylist);

        // Simulate delete + backup restore of the original row and ID.
        service.setCachedToken(oldPlaylist._id, 'RESTORED_TOKEN', oldPlaylist);

        await expect(service.ensureToken(oldPlaylist)).resolves.toEqual({
            token: 'RESTORED_TOKEN',
            serialNumber: undefined,
        });
    });
});
