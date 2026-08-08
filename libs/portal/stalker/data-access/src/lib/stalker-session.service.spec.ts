import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DataService, PlaylistsService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { StalkerPortalError } from './stalker-portal-error';
import { STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS } from './stalker-watchdog.controller';
import { stalkerSessionFingerprint } from './stalker-session-store';
import {
    STALKER_SERIAL_NUMBER,
    StalkerProfileResponse,
    StalkerSessionService,
} from './stalker-session.service';

type ExpectedStalkerPortalIdentity = {
    serialNumber?: string;
    deviceId1?: string;
    deviceId2?: string;
    signature1?: string;
    signature2?: string;
};

type GetProfileWithIdentity = (
    portalUrl: string,
    macAddress: string,
    token: string,
    identity: ExpectedStalkerPortalIdentity,
    handshakeRandom: string
) => Promise<StalkerProfileResponse>;

describe('StalkerSessionService watchdog row resolution', () => {
    const activationSnapshot = {
        _id: 'portal-1',
        title: 'Portal',
        portalUrl: 'https://portal.example.com/server/load.php',
        macAddress: '00:1A:79:AA:BB:CC',
        isFullStalkerPortal: true,
        lastUsage: '',
    } as unknown as Playlist;

    let sendIpcEvent: jest.Mock;
    let getPlaylistById: jest.Mock;
    let service: StalkerSessionService;

    beforeEach(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                subtle: {
                    digest: jest.fn(
                        async () => new Uint8Array(20).fill(1).buffer
                    ),
                },
            },
        });
        sendIpcEvent = jest
            .fn()
            .mockResolvedValue({ js: { token: 'TOK', random: 'r' } });
        getPlaylistById = jest.fn();

        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                { provide: DataService, useValue: { sendIpcEvent } },
                {
                    provide: PlaylistsService,
                    useValue: { getPlaylistById },
                },
            ],
        });
        service = TestBed.inject(StalkerSessionService);
    });

    it('authenticates watchdog pings as the freshly persisted row, not the activation snapshot', async () => {
        // The user edited the MAC after the watchdog started: the very next
        // ping must use the stored row — pairing the old identity would
        // keep an old session alive and repopulate the token cache with it.
        const editedRow = {
            ...activationSnapshot,
            macAddress: '00:1A:79:00:77:77',
        };
        getPlaylistById.mockReturnValue(of(editedRow));

        service.setActiveWatchdogPlaylist(activationSnapshot);
        // The init ping runs on a floating promise chain.
        for (let i = 0; i < 20; i += 1) {
            await Promise.resolve();
        }

        expect(getPlaylistById).toHaveBeenCalledWith('portal-1');
        expect(sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                macAddress: '00:1A:79:00:77:77',
            })
        );
        service.setActiveWatchdogPlaylist(null);
    });

    it('overlays the registered repair decorator on the resolved row', async () => {
        // Simple→full repair whose persistence has not landed yet: the row
        // still says simple, and without the overlay the ping would stop
        // the freshly started keepalive.
        const simpleRow = {
            ...activationSnapshot,
            isFullStalkerPortal: false,
        };
        getPlaylistById.mockReturnValue(of(simpleRow));
        service.registerWatchdogPlaylistDecorator((playlist) => ({
            ...playlist,
            isFullStalkerPortal: true,
        }));

        service.setActiveWatchdogPlaylist(activationSnapshot);
        for (let i = 0; i < 20; i += 1) {
            await Promise.resolve();
        }

        // The keepalive survived (no stopWatchdog) and authenticated.
        expect(sendIpcEvent).toHaveBeenCalled();
        service.setActiveWatchdogPlaylist(null);
    });
});

describe('StalkerSessionService identity-tagged token cache', () => {
    const playlistA = {
        _id: 'portal-1',
        title: 'Portal',
        portalUrl: 'https://portal.example.com/server/load.php',
        macAddress: '00:1A:79:AA:BB:CC',
        isFullStalkerPortal: true,
        lastUsage: '',
    } as unknown as Playlist;

    let sendIpcEvent: jest.Mock;
    let service: StalkerSessionService;

    beforeEach(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                subtle: {
                    digest: jest.fn(
                        async () => new Uint8Array(20).fill(1).buffer
                    ),
                },
            },
        });
        sendIpcEvent = jest
            .fn()
            .mockResolvedValue({ js: { token: 'FRESH', random: 'r' } });

        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                { provide: DataService, useValue: { sendIpcEvent } },
            ],
        });
        service = TestBed.inject(StalkerSessionService);
    });

    it('reuses a cached token only for the identity it was negotiated for', async () => {
        service.setCachedToken('portal-1', 'OLD-IDENTITY-TOKEN', playlistA);

        const sameIdentity = await service.ensureToken(playlistA);
        expect(sameIdentity.token).toBe('OLD-IDENTITY-TOKEN');
        expect(sendIpcEvent).not.toHaveBeenCalled();

        // The user edited the MAC: the cached session belongs to the old
        // identity and must be replaced by a fresh authentication.
        const editedIdentity = {
            ...playlistA,
            macAddress: '00:1A:79:00:66:66',
        } as Playlist;
        const reAuthenticated = await service.ensureToken(editedIdentity);

        expect(reAuthenticated.token).toBe('FRESH');
        expect(sendIpcEvent).toHaveBeenCalled();
    });

    it('does not hand an in-flight authentication result to an edited identity', async () => {
        // Deferred transport: the first auth (old identity) is still in
        // flight when the edited identity asks for a token.
        const pendingResolvers: Array<(value: unknown) => void> = [];
        sendIpcEvent.mockImplementation(
            () =>
                new Promise((resolve) => {
                    pendingResolvers.push(resolve);
                })
        );

        const oldAuth = service.ensureToken(playlistA);
        // ensureToken reads the persisted session before the handshake, so
        // wait for the transport call rather than a fixed microtask count.
        while (pendingResolvers.length === 0) {
            await new Promise((resolve) => setTimeout(resolve));
        }

        const editedIdentity = {
            ...playlistA,
            macAddress: '00:1A:79:00:55:55',
        } as Playlist;
        const editedAuth = service.ensureToken(editedIdentity);

        // Settle the OLD identity's handshake + profile.
        pendingResolvers[0]({ js: { token: 'TOKEN-OLD', random: 'r' } });
        while (pendingResolvers.length < 2) {
            await new Promise((resolve) => setTimeout(resolve));
        }
        pendingResolvers[1]({ js: {} });
        await expect(oldAuth).resolves.toMatchObject({ token: 'TOKEN-OLD' });

        // The edited identity re-enters and negotiates its OWN session.
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
        pendingResolvers[2]?.({ js: { token: 'TOKEN-NEW', random: 'r' } });
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
        pendingResolvers[3]?.({ js: {} });

        await expect(editedAuth).resolves.toMatchObject({
            token: 'TOKEN-NEW',
        });
    });

    it('treats IPC-wrapped HTTP 401/403 as an authorization failure', async () => {
        // The custom `status` property does not survive ipcRenderer, so an
        // expired-token 403 arrives as message text only.
        service.setCachedToken('portal-1', 'EXPIRED', playlistA);
        sendIpcEvent.mockRejectedValueOnce(
            new Error(
                "Error invoking remote method 'STALKER_REQUEST': HTTP Error 403: Forbidden"
            )
        );
        sendIpcEvent.mockResolvedValue({ js: { token: 'FRESH', random: 'r' } });

        await service
            .makeAuthenticatedRequest(playlistA, { action: 'get_genres' })
            .catch(() => undefined);

        // The dead token was retired rather than kept for the next caller.
        expect(service.getCachedToken('portal-1')).not.toBe('EXPIRED');
    });

    it('preserves HTTP status evidence when the authenticated retry also fails', async () => {
        const forbidden = {
            message: 'HTTP Error 403: Forbidden',
            status: 403,
        };
        service.setCachedToken('portal-1', 'EXPIRED', playlistA);
        sendIpcEvent
            .mockRejectedValueOnce(forbidden)
            .mockResolvedValueOnce({
                js: { token: 'FRESH', random: 'r' },
            })
            .mockResolvedValueOnce({ js: {} })
            .mockRejectedValueOnce(forbidden);

        await expect(
            service.makeAuthenticatedRequest(playlistA, {
                action: 'get_genres',
            })
        ).rejects.toBe(forbidden);

        // StalkerPortalRepairService consumes this exact transport evidence
        // to decide that endpoint discovery is justified.
        expect(forbidden.status).toBe(403);
    });

    it.each(['Access denied.', 'Unauthorized request.'])(
        'retires the token for the %j plain-text failure too',
        async (body) => {
            // The session predicate shares the discovery/repair failure
            // set: a phrase one layer treats as an auth failure must not be
            // ignored here, or the expired token survives the session.
            service.setCachedToken('portal-1', 'EXPIRED', playlistA);
            sendIpcEvent.mockResolvedValue(body);

            await service
                .makeAuthenticatedRequest(
                    playlistA,
                    { action: 'get_genres' },
                    false
                )
                .catch(() => undefined);

            expect(service.getCachedToken('portal-1')).toBeNull();
        }
    );

    it('does not treat a proxy page mentioning the phrase as an auth failure', async () => {
        // End to end through makeAuthenticatedRequest, not just the
        // primitive: this is the path that used to stringify the whole
        // response and match an unanchored `authorization failed`. A short
        // page from something in FRONT of the portal would retire the token,
        // retry, and throw a message that itself matches the repair trigger —
        // re-probing a portal that never refused anything.
        service.setCachedToken('portal-1', 'LIVE', playlistA);
        const body = 'The request Authorization failed. Try again later.';
        sendIpcEvent.mockResolvedValue(body);

        await expect(
            service.makeAuthenticatedRequest(playlistA, {
                action: 'get_genres',
            })
        ).resolves.toBe(body);

        // No retry, no retirement, nothing for the repair layer to act on.
        expect(sendIpcEvent).toHaveBeenCalledTimes(1);
        expect(service.getCachedToken('portal-1')).toBe('LIVE');
    });

    it('retires a failed token even on the no-retry path (watchdog pings)', async () => {
        service.setCachedToken('portal-1', 'DEAD', playlistA);
        sendIpcEvent.mockResolvedValue('Authorization failed.');

        // The typed refusal replaced the generic "Authorization failed after
        // retry": callers need the portal's own reason to show the user.
        await expect(
            service.makeAuthenticatedRequest(
                playlistA,
                { action: 'get_events' },
                false
            )
        ).rejects.toMatchObject({
            name: 'StalkerPortalError',
            kind: 'auth-failed',
            failureBody: 'Authorization failed.',
        });

        // Leaving the dead token cached would hand it to the next caller.
        expect(service.getCachedToken('portal-1')).toBeNull();
    });
});

describe('StalkerSessionService.refreshActiveWatchdogPlaylist', () => {
    const basePlaylist = {
        _id: 'portal-1',
        title: 'Portal',
        portalUrl: 'https://portal.example.com/server/load.php',
        macAddress: '00:1A:79:AA:BB:CC',
        isFullStalkerPortal: false,
        lastUsage: '',
    } as unknown as Playlist;

    let service: StalkerSessionService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                {
                    provide: DataService,
                    useValue: {
                        sendIpcEvent: jest.fn().mockResolvedValue({ js: {} }),
                    },
                },
            ],
        });
        service = TestBed.inject(StalkerSessionService);
    });

    it('re-applies the repaired configuration to the ACTIVE watchdog playlist', () => {
        service.setActiveWatchdogPlaylist(basePlaylist);
        const apply = jest.spyOn(service, 'setActiveWatchdogPlaylist');

        const repaired = {
            ...basePlaylist,
            isFullStalkerPortal: true,
        } as Playlist;
        service.refreshActiveWatchdogPlaylist(repaired);

        // Delegation is the contract: setActiveWatchdogPlaylist owns the
        // start/stop/repoint logic, refresh only feeds it the fresh row.
        expect(apply).toHaveBeenCalledWith(repaired);
        service.setActiveWatchdogPlaylist(null);
    });

    it('ignores playlists that do not own the watchdog', () => {
        service.setActiveWatchdogPlaylist(basePlaylist);
        const apply = jest.spyOn(service, 'setActiveWatchdogPlaylist');

        service.refreshActiveWatchdogPlaylist({
            ...basePlaylist,
            _id: 'other-portal',
            isFullStalkerPortal: true,
        } as Playlist);

        expect(apply).not.toHaveBeenCalled();
        service.setActiveWatchdogPlaylist(null);
    });

    it('is a no-op when no watchdog playlist is active at all', () => {
        const apply = jest.spyOn(service, 'setActiveWatchdogPlaylist');

        service.refreshActiveWatchdogPlaylist({
            ...basePlaylist,
            isFullStalkerPortal: true,
        } as Playlist);

        expect(apply).not.toHaveBeenCalled();
    });
});

describe('StalkerSessionService identity payloads', () => {
    const portalUrl =
        'https://portal.example.com/stalker_portal/server/load.php';
    const macAddress = '00:1A:79:AA:BB:CC';

    let service: StalkerSessionService;
    let dataService: { sendIpcEvent: jest.Mock };
    let playlistsService: {
        getPlaylistById: jest.Mock;
        updateStalkerSession: jest.Mock;
    };

    beforeEach(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                subtle: {
                    digest: jest.fn(
                        async () => new Uint8Array(20).fill(1).buffer
                    ),
                },
            },
        });

        dataService = {
            sendIpcEvent: jest.fn().mockResolvedValue({ js: {} }),
        };
        playlistsService = {
            getPlaylistById: jest.fn().mockReturnValue(of(undefined)),
            updateStalkerSession: jest.fn().mockReturnValue(of(null)),
        };

        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                { provide: DataService, useValue: dataService },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        });

        service = TestBed.inject(StalkerSessionService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('omits SN, device IDs, and signatures from get_profile when identity is blank', async () => {
        const getProfile =
            service.getProfile as unknown as GetProfileWithIdentity;

        await getProfile.call(
            service,
            portalUrl,
            macAddress,
            'token-1',
            {},
            'random-1'
        );

        const payload = lastStalkerPayload();
        expect(payload.serialNumber).toBeUndefined();
        expect(payload.params).not.toHaveProperty('sn');
        expect(payload.params).not.toHaveProperty('device_id');
        expect(payload.params).not.toHaveProperty('device_id2');
        expect(payload.params).not.toHaveProperty('signature');
        expect(payload.params).not.toHaveProperty('signature2');
        expect(JSON.parse(String(payload.params.metrics))).not.toHaveProperty(
            'sn'
        );
    });

    it('sends provided SN, device IDs, and signatures exactly in get_profile', async () => {
        const getProfile =
            service.getProfile as unknown as GetProfileWithIdentity;

        await getProfile.call(
            service,
            portalUrl,
            macAddress,
            'token-1',
            {
                serialNumber: 'CUSTOMSN123',
                deviceId1: 'DEVICE-ID-1',
                deviceId2: 'DEVICE-ID-2',
                signature1: 'SIGNATURE-1',
                signature2: 'SIGNATURE-2',
            },
            'random-1'
        );

        const payload = lastStalkerPayload();
        expect(payload.serialNumber).toBe('CUSTOMSN123');
        expect(payload.params).toEqual(
            expect.objectContaining({
                sn: 'CUSTOMSN123',
                device_id: 'DEVICE-ID-1',
                device_id2: 'DEVICE-ID-2',
                signature: 'SIGNATURE-1',
                signature2: 'SIGNATURE-2',
            })
        );
        expect(JSON.parse(String(payload.params.metrics))).toEqual(
            expect.objectContaining({
                sn: 'CUSTOMSN123',
            })
        );
    });

    it('passes stored playlist identity into ensureToken re-authentication', async () => {
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'fresh-token' });

        await service.ensureToken({
            _id: 'playlist-1',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
            stalkerSerialNumber: 'CUSTOMSN123',
            stalkerDeviceId1: 'DEVICE-ID-1',
            stalkerDeviceId2: 'DEVICE-ID-2',
            stalkerSignature1: 'SIGNATURE-1',
            stalkerSignature2: 'SIGNATURE-2',
        } as Playlist);

        expect(authenticate).toHaveBeenCalledWith(
            portalUrl,
            macAddress,
            {
                serialNumber: 'CUSTOMSN123',
                deviceId1: 'DEVICE-ID-1',
                deviceId2: 'DEVICE-ID-2',
                signature1: 'SIGNATURE-1',
                signature2: 'SIGNATURE-2',
            },
            // No cadence stored for this playlist, so the profile must run.
            expect.objectContaining({ skipProfileWhenReused: false })
        );
    });

    it('treats the legacy default serial number as absent during ensureToken', async () => {
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'fresh-token' });

        const result = await service.ensureToken({
            _id: 'playlist-1',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
            stalkerSerialNumber: STALKER_SERIAL_NUMBER,
        } as Playlist);

        expect(result.serialNumber).toBeUndefined();
        expect(authenticate).toHaveBeenCalledWith(
            portalUrl,
            macAddress,
            {},
            expect.objectContaining({ skipProfileWhenReused: false })
        );
    });

    it('serializes refreshAccountProfile behind an in-flight ensureToken', async () => {
        const playlist = {
            _id: 'playlist-1',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;

        let releaseFirst: (value: { token: string }) => void = () => undefined;
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        releaseFirst = resolve;
                    })
            )
            .mockResolvedValueOnce({
                token: 'profile-token',
                accountInfo: { login: 'user-1' },
            });

        const pending = service.ensureToken(playlist);
        const refresh = service.refreshAccountProfile(playlist);

        // Two handshakes must never overlap: on strict portals the second
        // would invalidate the first one's token. (Macrotask flush: the
        // persisted-token lookup adds awaits before authenticate fires.)
        await new Promise((resolve) => setTimeout(resolve));
        expect(authenticate).toHaveBeenCalledTimes(1);

        releaseFirst({ token: 'session-token' });
        await pending;
        const accountInfo = await refresh;

        expect(authenticate).toHaveBeenCalledTimes(2);
        expect(accountInfo).toEqual({ login: 'user-1' });
        // The refreshed token replaces the one its own handshake killed.
        expect(service.getCachedToken(playlist._id)).toBe('profile-token');
    });

    it('lets only one of several queued refreshes authenticate at a time', async () => {
        const playlist = {
            _id: 'playlist-3',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;

        const releases: Array<(value: { token: string }) => void> = [];
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockImplementation(
                () =>
                    new Promise((resolve) => {
                        releases.push(resolve);
                    })
            );

        // Both refreshes queue behind the same in-flight ensureToken, so
        // one settled promise releases both waiters at once.
        const pending = service.ensureToken(playlist);
        const first = service.refreshAccountProfile(playlist);
        const second = service.refreshAccountProfile(playlist);

        await new Promise((resolve) => setTimeout(resolve));
        expect(authenticate).toHaveBeenCalledTimes(1);

        releases[0]({ token: 'session-token' });
        await pending;
        await new Promise((resolve) => setTimeout(resolve));

        // The released waiters must not both start a handshake.
        expect(authenticate).toHaveBeenCalledTimes(2);

        releases[1]({ token: 'first-refresh-token' });
        await first;
        await new Promise((resolve) => setTimeout(resolve));

        expect(authenticate).toHaveBeenCalledTimes(3);
        releases[2]({ token: 'second-refresh-token' });
        await second;

        expect(service.getCachedToken(playlist._id)).toBe(
            'second-refresh-token'
        );
    });

    it('retires the cached token before the refresh handshake starts', async () => {
        const playlist = {
            _id: 'playlist-4',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;

        service.setCachedToken(playlist._id, 'stale-token', playlist);

        let release: (value: { token: string }) => void = () => undefined;
        jest.spyOn(service, 'authenticate').mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                })
        );

        const refresh = service.refreshAccountProfile(playlist);
        await Promise.resolve();

        // ensureToken() reads the cache before pendingAuth, so a token the
        // handshake is invalidating must not stay readable meanwhile.
        expect(service.getCachedToken(playlist._id)).toBeNull();

        release({ token: 'fresh-token' });
        await refresh;
        expect(service.getCachedToken(playlist._id)).toBe('fresh-token');
    });

    it('keeps a freshly refreshed token when a stale request fails auth late', async () => {
        const playlist = {
            _id: 'playlist-5',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;

        // The request went out with the previous token; meanwhile a
        // profile refresh has already cached a fresh one.
        jest.spyOn(service, 'ensureToken')
            .mockResolvedValueOnce({ token: 'stale-token' })
            .mockResolvedValueOnce({ token: 'fresh-token' });
        service.setCachedToken(playlist._id, 'fresh-token', playlist);

        dataService.sendIpcEvent
            .mockResolvedValueOnce({ js: 'Authorization failed. 75' })
            .mockResolvedValueOnce({ js: { data: [] } });

        await service.makeAuthenticatedRequest(playlist, {
            type: 'itv',
            action: 'get_ordered_list',
        });

        // The late failure of the stale token must not delete the fresh
        // one — the retry reuses it instead of forcing a new handshake.
        expect(service.getCachedToken(playlist._id)).toBe('fresh-token');
        expect(dataService.sendIpcEvent).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ token: 'fresh-token' })
        );
    });

    it('still retires the cached token when it is the one that failed', async () => {
        const playlist = {
            _id: 'playlist-6',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;

        jest.spyOn(service, 'ensureToken')
            .mockResolvedValueOnce({ token: 'dead-token' })
            .mockResolvedValueOnce({ token: 'new-token' });
        service.setCachedToken(playlist._id, 'dead-token', playlist);

        dataService.sendIpcEvent
            .mockResolvedValueOnce({ js: 'Authorization failed. 75' })
            .mockResolvedValueOnce({ js: { data: [] } });

        await service.makeAuthenticatedRequest(playlist, {
            type: 'itv',
            action: 'get_ordered_list',
        });

        // Existing behavior preserved: the failed token itself is gone.
        expect(service.getCachedToken(playlist._id)).toBeNull();
    });

    it('refreshes the account profile even when a pending authentication fails', async () => {
        const playlist = {
            _id: 'playlist-2',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;

        jest.spyOn(service, 'authenticate')
            .mockRejectedValueOnce(new Error('handshake refused'))
            .mockResolvedValueOnce({
                token: 'profile-token',
                accountInfo: { login: 'user-2' },
            });

        const pending = service.ensureToken(playlist).catch(() => undefined);
        const accountInfo = await service.refreshAccountProfile(playlist);
        await pending;

        expect(accountInfo).toEqual({ login: 'user-2' });
    });

    it('re-presents the token persisted on the playlist during ensureToken', async () => {
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'STORED-TOKEN' });

        await service.ensureToken({
            _id: 'playlist-7',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
            stalkerToken: 'STORED-TOKEN',
            stalkerSessionIdentity: stalkerSessionFingerprint({
                portalUrl,
                macAddress,
            } as Playlist),
            // With the cadence present the playlist is self-sufficient, so no
            // row read is needed.
            stalkerWatchdogTimeout: 120,
        } as Playlist);

        expect(playlistsService.getPlaylistById).not.toHaveBeenCalled();
        expect(authenticate).toHaveBeenCalledWith(
            portalUrl,
            macAddress,
            {},
            expect.objectContaining({
                storedToken: 'STORED-TOKEN',
                skipProfileWhenReused: true,
            })
        );
    });

    it('falls back to the stored playlist row for the persisted token', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'playlist-8',
                stalkerToken: 'ROW-TOKEN',
                stalkerSessionIdentity: stalkerSessionFingerprint({
                    portalUrl,
                    macAddress,
                } as Playlist),
                stalkerWatchdogTimeout: 120,
            } as Playlist)
        );
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'ROW-TOKEN', reusedStoredToken: true });

        await service.ensureToken({
            _id: 'playlist-8',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist);

        expect(playlistsService.getPlaylistById).toHaveBeenCalledWith(
            'playlist-8'
        );
        expect(authenticate).toHaveBeenCalledWith(
            portalUrl,
            macAddress,
            {},
            expect.objectContaining({ storedToken: 'ROW-TOKEN' })
        );
        // A reused token was not renegotiated — nothing to write back.
        expect(playlistsService.updateStalkerSession).not.toHaveBeenCalled();
    });

    it('writes a newly negotiated token back to the playlist', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({ _id: 'playlist-9', stalkerToken: 'OLD-TOKEN' } as Playlist)
        );
        jest.spyOn(service, 'authenticate').mockResolvedValue({
            token: 'NEW-TOKEN',
            reusedStoredToken: false,
        });

        await service.ensureToken({
            _id: 'playlist-9',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist);

        expect(playlistsService.updateStalkerSession).toHaveBeenCalledWith(
            'playlist-9',
            expect.objectContaining({ stalkerToken: 'NEW-TOKEN' })
        );
    });

    it('applies the persisted watchdog cadence when the token is reused', async () => {
        // Reuse skips the get_profile that carries the cadence, so without
        // the persisted values the watchdog would sit on its 120 s default
        // for the whole session — for a portal that advertised 60 s that is
        // slower than before this feature existed.
        const watchdog = (
            service as unknown as {
                watchdog: { applyProfileTiming: jest.Mock };
            }
        ).watchdog;
        jest.spyOn(watchdog, 'applyProfileTiming');

        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'playlist-12',
                stalkerToken: 'REUSED',
                stalkerWatchdogTimeout: 60,
                stalkerTimeslot: 7,
            } as Playlist)
        );
        jest.spyOn(service, 'authenticate').mockResolvedValue({
            token: 'REUSED',
            reusedStoredToken: true,
        });

        await service.ensureToken({
            _id: 'playlist-12',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist);

        expect(watchdog.applyProfileTiming).toHaveBeenCalledWith(
            'playlist-12',
            { watchdogTimeoutSeconds: 60, timeslotSeconds: 7 }
        );
    });

    it('profiles a legacy token-only playlist and refuses its unverified token', async () => {
        // A playlist written before this change has a token but no recorded
        // fingerprint, so nothing proves which endpoint/identity it belongs
        // to — re-presenting it after an edit is the disclosure the
        // fingerprint exists to prevent. It owes a full profile anyway (no
        // cadence), so refusing the token costs nothing and the write-back
        // then records the fingerprint.
        playlistsService.getPlaylistById.mockReturnValue(
            of({ _id: 'playlist-16', stalkerToken: 'LEGACY' } as Playlist)
        );
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({
                token: 'LEGACY',
                reusedStoredToken: false,
                watchdogTimeoutSeconds: 60,
                timeslotSeconds: 5,
            });

        await service.ensureToken({
            _id: 'playlist-16',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist);

        expect(authenticate).toHaveBeenCalledWith(
            portalUrl,
            macAddress,
            {},
            expect.objectContaining({
                storedToken: undefined,
                skipProfileWhenReused: false,
            })
        );
        // ...and the learned cadence is persisted, so the next start skips.
        expect(playlistsService.updateStalkerSession).toHaveBeenCalledWith(
            'playlist-16',
            expect.objectContaining({
                stalkerWatchdogTimeout: 60,
                stalkerTimeslot: 5,
            })
        );
    });

    it('records the effective cadence when the portal advertises none', async () => {
        // Otherwise "no cadence stored" would keep meaning "never profiled"
        // and such a portal would be re-profiled on every single start.
        playlistsService.getPlaylistById.mockReturnValue(
            of({ _id: 'playlist-17', stalkerToken: 'LEGACY' } as Playlist)
        );
        jest.spyOn(service, 'authenticate').mockResolvedValue({
            token: 'LEGACY',
            reusedStoredToken: false,
        });

        await service.ensureToken({
            _id: 'playlist-17',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist);

        expect(playlistsService.updateStalkerSession).toHaveBeenCalledWith(
            'playlist-17',
            expect.objectContaining({
                stalkerWatchdogTimeout: STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS,
                stalkerTimeslot: 0,
            })
        );
    });

    it('refuses a cached and persisted session after the login changed', async () => {
        // For a status-2 portal the login decides WHICH account the token
        // represents, so serving the old session would keep the user on the
        // previous account indefinitely.
        const before = {
            _id: 'playlist-login-change',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
            username: 'old-user',
            password: 'old-pass',
        } as Playlist;
        service.setCachedToken(before._id, 'OLD-ACCOUNT-TOKEN', before);
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                ...before,
                stalkerToken: 'OLD-ACCOUNT-TOKEN',
                stalkerSessionIdentity: stalkerSessionFingerprint(before),
                stalkerWatchdogTimeout: 60,
            } as Playlist)
        );
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'NEW', reusedStoredToken: false });

        const result = await service.ensureToken({
            ...before,
            username: 'new-user',
            password: 'new-pass',
        } as Playlist);

        // Neither the in-run cache nor the persisted token is reused.
        expect(result.token).toBe('NEW');
        expect(authenticate).toHaveBeenCalledWith(
            portalUrl,
            macAddress,
            {},
            expect.objectContaining({
                storedToken: undefined,
                credentials: { username: 'new-user', password: 'new-pass' },
            })
        );
    });

    it('refuses a persisted token across tenants on the SAME host', async () => {
        // Discovery deliberately preserves tenant base paths, so two portals
        // can share an origin. An origin-only key would send tenant A's
        // bearer to tenant B.
        const tenantA = {
            _id: 'playlist-tenant',
            portalUrl: 'https://panel.example.com/tenant-a/server/load.php',
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                ...tenantA,
                stalkerToken: 'TENANT-A-TOKEN',
                stalkerSessionIdentity: stalkerSessionFingerprint(tenantA),
                stalkerWatchdogTimeout: 60,
            } as Playlist)
        );
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'FRESH', reusedStoredToken: false });

        await service.ensureToken({
            ...tenantA,
            portalUrl: 'https://panel.example.com/tenant-b/server/load.php',
        } as Playlist);

        expect(authenticate).toHaveBeenCalledWith(
            'https://panel.example.com/tenant-b/server/load.php',
            macAddress,
            {},
            expect.objectContaining({ storedToken: undefined })
        );
    });

    it('keeps the session for the same endpoint spelled with a trailing slash', async () => {
        // Normalisation must not turn a cosmetic difference into a forced
        // re-authentication.
        const portal = {
            _id: 'playlist-slash',
            portalUrl: 'https://panel.example.com/tenant-a/server/load.php',
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;
        expect(
            stalkerSessionFingerprint({
                ...portal,
                portalUrl:
                    'https://panel.example.com/tenant-a/server/load.php/',
            } as Playlist)
        ).toBe(stalkerSessionFingerprint(portal));
    });

    it('refuses a persisted token when the playlist was repointed at another host', async () => {
        // ensureToken re-presents persisted tokens in a handshake, so an
        // identity-only check would disclose the previous portal's bearer
        // token to an unrelated server.
        const original = {
            _id: 'playlist-moved',
            portalUrl: 'https://old.example.com/stalker_portal/server/load.php',
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                ...original,
                stalkerToken: 'OLD-HOST-TOKEN',
                stalkerSessionIdentity: stalkerSessionFingerprint(original),
                stalkerWatchdogTimeout: 60,
            } as Playlist)
        );
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'FRESH', reusedStoredToken: false });

        await service.ensureToken({
            ...original,
            portalUrl: 'https://new.example.com/stalker_portal/server/load.php',
        } as Playlist);

        expect(authenticate).toHaveBeenCalledWith(
            'https://new.example.com/stalker_portal/server/load.php',
            macAddress,
            {},
            expect.objectContaining({ storedToken: undefined })
        );
    });

    it('refuses a persisted token minted for a different identity', async () => {
        // The playlist was edited after the token was issued. Re-presenting
        // it would pair the new identity with the old session — the same bug
        // class the in-memory cache guards against, just across a restart.
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'playlist-identity',
                stalkerToken: 'OLD-IDENTITY-TOKEN',
                stalkerSessionIdentity: 'not-the-current-fingerprint',
                stalkerWatchdogTimeout: 60,
            } as Playlist)
        );
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'FRESH', reusedStoredToken: false });

        await service.ensureToken({
            _id: 'playlist-identity',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist);

        expect(authenticate).toHaveBeenCalledWith(
            portalUrl,
            macAddress,
            {},
            expect.objectContaining({ storedToken: undefined })
        );
    });

    it('reuses a persisted token whose identity still matches', async () => {
        const playlist = {
            _id: 'playlist-identity-ok',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                ...playlist,
                stalkerToken: 'SAME-IDENTITY-TOKEN',
                stalkerSessionIdentity: stalkerSessionFingerprint(playlist),
                stalkerWatchdogTimeout: 60,
            } as Playlist)
        );
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({
                token: 'SAME-IDENTITY-TOKEN',
                reusedStoredToken: true,
            });

        await service.ensureToken(playlist);

        expect(authenticate).toHaveBeenCalledWith(
            portalUrl,
            macAddress,
            {},
            expect.objectContaining({ storedToken: 'SAME-IDENTITY-TOKEN' })
        );
    });

    it('reads the stored row when a token arrives without its cadence', async () => {
        // A playlist shape that copies the token but not the timing fields
        // must not silently downgrade the portal to the 120 s default.
        const watchdog = (
            service as unknown as {
                watchdog: { applyProfileTiming: jest.Mock };
            }
        ).watchdog;
        jest.spyOn(watchdog, 'applyProfileTiming');

        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'playlist-15',
                stalkerToken: 'REUSED',
                stalkerWatchdogTimeout: 45,
                stalkerTimeslot: 3,
            } as Playlist)
        );
        jest.spyOn(service, 'authenticate').mockResolvedValue({
            token: 'REUSED',
            reusedStoredToken: true,
        });

        await service.ensureToken({
            _id: 'playlist-15',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
            // Token present, cadence absent — the shortcut must not fire.
            stalkerToken: 'REUSED',
        } as Playlist);

        expect(playlistsService.getPlaylistById).toHaveBeenCalledWith(
            'playlist-15'
        );
        expect(watchdog.applyProfileTiming).toHaveBeenCalledWith(
            'playlist-15',
            { watchdogTimeoutSeconds: 45, timeslotSeconds: 3 }
        );
    });

    it('persists a freshly decoded watchdog cadence with the token', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({ _id: 'playlist-13' } as Playlist)
        );
        jest.spyOn(service, 'authenticate').mockResolvedValue({
            token: 'NEW-TOKEN',
            reusedStoredToken: false,
            watchdogTimeoutSeconds: 90,
            timeslotSeconds: 12,
        });

        await service.ensureToken({
            _id: 'playlist-13',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist);

        expect(playlistsService.updateStalkerSession).toHaveBeenCalledWith(
            'playlist-13',
            expect.objectContaining({
                stalkerToken: 'NEW-TOKEN',
                stalkerWatchdogTimeout: 90,
                stalkerTimeslot: 12,
                // The identity the session was negotiated for, so a later
                // start can refuse to reuse it after an identity edit.
                stalkerSessionIdentity: expect.any(String),
            })
        );
    });

    it('rewrites the session when only the cadence changed', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'playlist-14',
                stalkerToken: 'SAME',
                stalkerWatchdogTimeout: 120,
            } as Playlist)
        );
        jest.spyOn(service, 'authenticate').mockResolvedValue({
            token: 'SAME',
            reusedStoredToken: false,
            watchdogTimeoutSeconds: 45,
        });

        await service.ensureToken({
            _id: 'playlist-14',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist);

        expect(playlistsService.updateStalkerSession).toHaveBeenCalledWith(
            'playlist-14',
            expect.objectContaining({ stalkerWatchdogTimeout: 45 })
        );
    });

    it('surfaces the portal failure body when the retry also fails', async () => {
        const playlist = {
            _id: 'playlist-10',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;

        jest.spyOn(service, 'ensureToken').mockResolvedValue({
            token: 'token-1',
        });
        // The transport marker for a blocked account, on both attempts.
        dataService.sendIpcEvent.mockResolvedValue({
            stalkerAuthFailure: 'Access denied.',
        });

        await expect(
            service.makeAuthenticatedRequest(playlist, {
                type: 'vod',
                action: 'get_categories',
            })
        ).rejects.toMatchObject({
            name: 'StalkerPortalError',
            kind: 'auth-failed',
            failureBody: 'Access denied.',
        });
        // One retry happened before giving up.
        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(2);
    });

    it('recognizes the raw PWA plain-text failure body and retries', async () => {
        const playlist = {
            _id: 'playlist-11',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
        } as Playlist;

        jest.spyOn(service, 'ensureToken')
            .mockResolvedValueOnce({ token: 'stale' })
            .mockResolvedValueOnce({ token: 'fresh' });
        dataService.sendIpcEvent
            .mockResolvedValueOnce('Unauthorized request.')
            .mockResolvedValueOnce({ js: { data: [] } });

        await expect(
            service.makeAuthenticatedRequest(playlist, {
                type: 'itv',
                action: 'get_ordered_list',
            })
        ).resolves.toEqual({ js: { data: [] } });
    });

    it('throws StalkerPortalError with the portal text when auth is refused', async () => {
        // Device conflict: get_profile answers status 1 with msg/block_msg.
        dataService.sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'token-1', random: 'random-1' },
            })
            .mockResolvedValueOnce({
                js: {
                    status: 1,
                    msg: 'device conflict - device_id mismatch',
                    block_msg: 'Your STB is damaged.<br/> Call the provider.',
                },
            });

        await expect(
            service.authenticate(portalUrl, macAddress)
        ).rejects.toMatchObject({
            name: 'StalkerPortalError',
            kind: 'device-conflict',
            portalText:
                'device conflict - device_id mismatch — Your STB is damaged. Call the provider.',
        });
    });

    it('keeps StalkerPortalError recognizable via instanceof', () => {
        expect(new StalkerPortalError('blocked')).toBeInstanceOf(Error);
    });

    it('passes an explicit serial into the initial handshake request', async () => {
        dataService.sendIpcEvent
            .mockResolvedValueOnce({
                js: {
                    token: 'token-1',
                    random: 'random-1',
                },
            })
            .mockResolvedValueOnce({ js: {} });

        await service.authenticate(portalUrl, macAddress, {
            serialNumber: 'CUSTOMSN123',
        });

        const handshakePayload = dataService.sendIpcEvent.mock.calls[0][1];
        expect(handshakePayload.params.action).toBe('handshake');
        expect(handshakePayload.serialNumber).toBe('CUSTOMSN123');
    });

    it('does not log credentials from portal request errors', async () => {
        const token = 'stalker-error-token-secret';
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        dataService.sendIpcEvent.mockRejectedValue(
            new Error(
                `Request failed: https://portal.example/api?token=${token}&action=get_profile`
            )
        );

        await expect(
            service.getProfile(portalUrl, macAddress, token, {}, 'random-1')
        ).rejects.toThrow('Request failed');

        const output = consoleError.mock.calls
            .flatMap((call) =>
                call.map((value) =>
                    value instanceof Error
                        ? `${value.message}\n${value.stack ?? ''}`
                        : JSON.stringify(value)
                )
            )
            .join('\n');
        expect(output).not.toContain(token);
        expect(output).toContain('get_profile');
    });

    function lastStalkerPayload(): {
        params: Record<string, unknown>;
        serialNumber?: string;
    } {
        return dataService.sendIpcEvent.mock.calls.at(-1)?.[1];
    }
});
