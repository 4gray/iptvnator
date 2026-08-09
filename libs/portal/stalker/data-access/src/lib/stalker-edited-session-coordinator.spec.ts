import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { DataService, PlaylistsService } from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from './stalker-session.service';
import { stalkerSessionFingerprint } from './stalker-session-store';

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
    let sendIpcEvent: jest.Mock;
    let resolveOldAuthentication: (
        value: Awaited<ReturnType<StalkerSessionService['authenticate']>>
    ) => void = () => undefined;
    let service: StalkerSessionService;
    let getPlaylistById: jest.Mock;
    let updatePlaylistMeta: jest.Mock;
    let transformPlaylistMeta: jest.Mock;
    let updateStalkerSession: jest.Mock;

    beforeEach(() => {
        getPlaylistById = jest.fn(() => of(oldPlaylist));
        updatePlaylistMeta = jest.fn(() => of(oldPlaylist));
        transformPlaylistMeta = jest.fn((_id, transform) =>
            of(transform(oldPlaylist))
        );
        updateStalkerSession = jest.fn(() => of(oldPlaylist));
        sendIpcEvent = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                {
                    provide: DataService,
                    useValue: { sendIpcEvent },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById,
                        updatePlaylistMeta,
                        transformPlaylistMeta,
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

    it('blocks new authentication while a same-fingerprint edit owns the playlist', async () => {
        const textOnlyEdit = {
            ...oldPlaylist,
            portalUrl: `${oldPlaylist.portalUrl}/`,
        };
        expect(stalkerSessionFingerprint(textOnlyEdit)).toBe(
            stalkerSessionFingerprint(oldPlaylist)
        );
        const fence = await service.beginEditDiscovery(textOnlyEdit);

        await expect(service.ensureToken(oldPlaylist)).rejects.toThrow(
            /stale/i
        );
        expect(authenticate).not.toHaveBeenCalled();

        service.cancelEditDiscovery(fence);
    });

    it('blocks runtime authentication while portal repair discovery owns the playlist', async () => {
        const repairFence = service.beginPortalRepairDiscovery(oldPlaylist._id);
        await repairFence.drained;

        const authentication = service.ensureToken(oldPlaylist);
        for (let i = 0; i < 5; i += 1) {
            await Promise.resolve();
        }
        expect(authenticate).not.toHaveBeenCalled();

        service.completePortalRepairDiscovery(repairFence);
        while (authenticate.mock.calls.length === 0) {
            await Promise.resolve();
        }
        resolveOldAuthentication({ token: 'REPAIRED_TOKEN' });

        await expect(authentication).resolves.toMatchObject({
            token: 'REPAIRED_TOKEN',
        });
    });

    it('drains authentication that started before portal repair discovery', async () => {
        const authentication = service.ensureToken(oldPlaylist);
        while (authenticate.mock.calls.length === 0) {
            await Promise.resolve();
        }

        const repairFence = service.beginPortalRepairDiscovery(oldPlaylist._id);
        let drained = false;
        void repairFence.drained.then(() => {
            drained = true;
        });
        await Promise.resolve();
        expect(drained).toBe(false);

        resolveOldAuthentication({ token: 'PRE_REPAIR_TOKEN' });
        await expect(authentication).rejects.toThrow(/stale/i);
        await repairFence.drained;
        expect(drained).toBe(true);

        service.completePortalRepairDiscovery(repairFence);
    });

    it('rejects an overlapping edit without retiring the first owner', async () => {
        const firstFence = await service.beginEditDiscovery(oldPlaylist);

        await expect(
            service.beginEditDiscovery({
                ...oldPlaylist,
                username: 'second-edit',
            })
        ).rejects.toThrow(/already in progress/i);

        await expect(
            service.replaceSessionAfterEdit(
                { ...oldPlaylist, stalkerToken: 'FIRST_EDIT_TOKEN' },
                firstFence
            )
        ).resolves.toEqual(oldPlaylist);
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

    it('rejects a stale full snapshot after a mode-only edit to simple', async () => {
        const simplePlaylist = {
            ...oldPlaylist,
            isFullStalkerPortal: false,
            stalkerToken: undefined,
            stalkerSessionIdentity: undefined,
        } as Playlist;
        updatePlaylistMeta.mockReturnValueOnce(of(simplePlaylist));
        getPlaylistById.mockReturnValueOnce(of(simplePlaylist));
        authenticate.mockReset().mockResolvedValue({
            token: 'STALE_FULL_TOKEN',
        });

        await service.replaceSessionAfterEdit(simplePlaylist);

        await expect(service.ensureToken(oldPlaylist)).rejects.toThrow(
            /stale/i
        );
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('rejects a stale simple snapshot after a mode-only edit to full', async () => {
        const simplePlaylist = {
            ...oldPlaylist,
            isFullStalkerPortal: false,
        } as Playlist;
        const resolvedFullPlaylist = {
            ...oldPlaylist,
            stalkerToken: 'NEW_FULL_TOKEN',
        } as Playlist;
        updatePlaylistMeta.mockReturnValueOnce(of(resolvedFullPlaylist));
        getPlaylistById.mockReturnValueOnce(of(resolvedFullPlaylist));

        const fence = await service.beginEditDiscovery(simplePlaylist);
        await service.replaceSessionAfterEdit(resolvedFullPlaylist, fence);

        await expect(service.ensureToken(simplePlaylist)).rejects.toThrow(
            /stale/i
        );
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('rejects an authenticated response completed after Edit commits', async () => {
        service.setCachedToken(oldPlaylist._id, 'OLD_TOKEN', oldPlaylist);
        let resolveOldResponse!: (value: unknown) => void;
        sendIpcEvent.mockReturnValueOnce(
            new Promise((resolve) => (resolveOldResponse = resolve))
        );
        const oldRequest = service.makeAuthenticatedRequest(oldPlaylist, {
            type: 'itv',
            action: 'get_genres',
        });
        while (sendIpcEvent.mock.calls.length === 0) {
            await Promise.resolve();
        }

        const editedPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://new.example.com/server/load.php',
            stalkerToken: 'NEW_TOKEN',
        } as Playlist;
        updatePlaylistMeta.mockReturnValueOnce(of(editedPlaylist));
        await service.replaceSessionAfterEdit(editedPlaylist);
        resolveOldResponse({ js: { data: ['STALE_CATEGORY'] } });

        await expect(oldRequest).rejects.toThrow(/stale/i);
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

    it('atomically merges only connection fields into a newer row after navigation', async () => {
        const currentPlaylist = {
            ...oldPlaylist,
            title: 'Newer title',
            epgUrls: ['https://new.example.com/epg.xml'],
        } as Playlist;
        transformPlaylistMeta.mockImplementationOnce((_id, transform) =>
            of(transform(currentPlaylist))
        );
        const editedPlaylist = {
            ...oldPlaylist,
            title: 'Stale form title',
            portalUrl: 'https://new.example.com/server/load.php',
            username: 'subscriber',
            stalkerToken: 'NEW_TOKEN',
            stalkerWatchdogTimeout: 90,
            stalkerTimeslot: 5,
        } as Playlist;
        const fence = await service.beginEditDiscovery(
            editedPlaylist,
            oldPlaylist
        );

        const persisted = await service.replaceSessionAfterEdit(
            editedPlaylist,
            fence,
            { preserveCurrentMetadata: true }
        );

        expect(updatePlaylistMeta).not.toHaveBeenCalled();
        expect(transformPlaylistMeta).toHaveBeenCalledWith(
            oldPlaylist._id,
            expect.any(Function)
        );
        expect(persisted).toEqual(
            expect.objectContaining({
                title: 'Newer title',
                epgUrls: ['https://new.example.com/epg.xml'],
                portalUrl: 'https://new.example.com/server/load.php',
                username: 'subscriber',
                stalkerToken: 'NEW_TOKEN',
                stalkerWatchdogTimeout: 90,
                stalkerTimeslot: 5,
            })
        );
    });

    it('rejects a late merge after another connection replaces the playlist ID', async () => {
        const replacementPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://restored.example.com/portal.php',
            macAddress: '00:1A:79:11:22:33',
        } as Playlist;
        transformPlaylistMeta.mockImplementationOnce((_id, transform) =>
            of(transform(replacementPlaylist))
        );
        const editedPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://new.example.com/server/load.php',
            stalkerToken: 'NEW_TOKEN',
        } as Playlist;
        const fence = await service.beginEditDiscovery(
            editedPlaylist,
            oldPlaylist
        );

        await expect(
            service.replaceSessionAfterEdit(editedPlaylist, fence, {
                preserveCurrentMetadata: true,
            })
        ).rejects.toThrow(/could not be persisted/i);

        expect(service.getCachedToken(oldPlaylist._id)).toBeNull();
        expect(updatePlaylistMeta).not.toHaveBeenCalled();
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

    it('rechecks edit ownership after an asynchronous authority rebase', async () => {
        const editedPlaylist = {
            ...oldPlaylist,
            portalUrl: 'https://new.example.com/server/load.php',
            stalkerToken: 'NEW_TOKEN',
        };
        await service.replaceSessionAfterEdit(editedPlaylist);

        const persistedRow = new Subject<Playlist>();
        getPlaylistById.mockReturnValueOnce(persistedRow);
        const restoredRequest = service.ensureToken(oldPlaylist);
        while (getPlaylistById.mock.calls.length === 0) {
            await Promise.resolve();
        }

        const fence = await service.beginEditDiscovery({
            ...oldPlaylist,
            username: 'new-user',
        });
        persistedRow.next(oldPlaylist);
        persistedRow.complete();

        await expect(restoredRequest).rejects.toThrow(/stale/i);
        expect(authenticate).not.toHaveBeenCalled();

        service.cancelEditDiscovery(fence);
    });
});
