import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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
        expect(updateStalkerSession).toHaveBeenLastCalledWith(
            oldPlaylist._id,
            expect.objectContaining({ stalkerToken: 'NEW_TOKEN' })
        );
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
});
