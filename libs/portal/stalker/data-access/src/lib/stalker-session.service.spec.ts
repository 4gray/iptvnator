import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DataService, PlaylistsService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
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
        for (let i = 0; i < 5; i += 1) {
            await Promise.resolve();
        }

        const editedIdentity = {
            ...playlistA,
            macAddress: '00:1A:79:00:55:55',
        } as Playlist;
        const editedAuth = service.ensureToken(editedIdentity);

        // Settle the OLD identity's handshake + profile.
        pendingResolvers[0]({ js: { token: 'TOKEN-OLD', random: 'r' } });
        for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
        }
        pendingResolvers[1]?.({ js: {} });
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

    it('retires a failed token even on the no-retry path (watchdog pings)', async () => {
        service.setCachedToken('portal-1', 'DEAD', playlistA);
        sendIpcEvent.mockResolvedValue('Authorization failed.');

        await expect(
            service.makeAuthenticatedRequest(
                playlistA,
                { action: 'get_events' },
                false
            )
        ).rejects.toThrow('Authorization failed after retry');

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

        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                { provide: DataService, useValue: dataService },
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

        expect(authenticate).toHaveBeenCalledWith(portalUrl, macAddress, {
            serialNumber: 'CUSTOMSN123',
            deviceId1: 'DEVICE-ID-1',
            deviceId2: 'DEVICE-ID-2',
            signature1: 'SIGNATURE-1',
            signature2: 'SIGNATURE-2',
        });
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
        expect(authenticate).toHaveBeenCalledWith(portalUrl, macAddress, {});
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
        // would invalidate the first one's token.
        await Promise.resolve();
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

        await Promise.resolve();
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
