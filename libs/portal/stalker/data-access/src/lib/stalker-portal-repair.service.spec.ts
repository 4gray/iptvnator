import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerPortalDiscoveryService } from './stalker-portal-discovery.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { StalkerSessionService } from './stalker-session.service';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const MISCLASSIFIED = {
    _id: 'portal-1',
    title: 'Canonical Ministra',
    portalUrl: 'http://ministra.example/server/load.php',
    macAddress: '00:1A:79:AA:BB:CC',
    isFullStalkerPortal: false,
} as PlaylistMeta;

async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
        await Promise.resolve();
    }
}

describe('StalkerPortalRepairService', () => {
    const originalLockManager = globalThis.navigator?.locks;
    let service: StalkerPortalRepairService;
    let discover: jest.Mock;
    let transformPlaylistMeta: jest.Mock;
    let getPlaylistById: jest.Mock;
    /** What the persisted row looks like when the repair re-verifies it. */
    let persistedRow: Playlist | undefined;
    /** The row the atomic transform actually wrote, if any. */
    let writtenRow: Playlist | null;
    /** When set, the atomic write fails AFTER the transform verified. */
    let persistError: Error | null;
    let setCachedToken: jest.Mock;
    let adoptDiscoveredSession: jest.Mock;
    let adoptDiscoveredSimplePortal: jest.Mock;
    let clearCachedToken: jest.Mock;
    let refreshActiveWatchdogPlaylist: jest.Mock;
    let beginPortalRepairDiscovery: jest.Mock;
    let completePortalRepairDiscovery: jest.Mock;

    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: {
                request: jest.fn(
                    async <T>(
                        name: string,
                        options: LockOptions,
                        callback: (lock: Lock | null) => Promise<T>
                    ) =>
                        callback({
                            name,
                            mode: options.mode ?? 'exclusive',
                        } as Lock)
                ),
            },
        });
        discover = jest.fn();
        persistedRow = MISCLASSIFIED as Playlist;
        writtenRow = null;
        persistError = null;
        // Mirrors PlaylistsService.transformPlaylistMeta semantics: the
        // transform runs on the current row inside the write queue; null
        // aborts, otherwise the returned row is persisted.
        transformPlaylistMeta = jest.fn((_id, transform) => {
            if (!persistedRow) {
                return of(null);
            }
            const next = transform(persistedRow) as Playlist | null;
            if (next === null) {
                return of(null);
            }
            if (persistError) {
                return throwError(() => persistError);
            }
            writtenRow = next;
            return of(next);
        });
        getPlaylistById = jest.fn(() => of(persistedRow));
        setCachedToken = jest.fn();
        adoptDiscoveredSession = jest.fn();
        adoptDiscoveredSimplePortal = jest.fn();
        clearCachedToken = jest.fn();
        refreshActiveWatchdogPlaylist = jest.fn();
        beginPortalRepairDiscovery = jest.fn((playlistId: string) => ({
            playlistId,
            owner: Symbol('portal-repair'),
            drained: Promise.resolve(),
        }));
        completePortalRepairDiscovery = jest.fn();

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: StalkerPortalDiscoveryService,
                    useValue: { discover },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        transformPlaylistMeta,
                        getPlaylistById,
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        setCachedToken,
                        adoptDiscoveredSession,
                        adoptDiscoveredSimplePortal,
                        clearCachedToken,
                        refreshActiveWatchdogPlaylist,
                        beginPortalRepairDiscovery,
                        completePortalRepairDiscovery,
                    },
                },
            ],
        });

        service = TestBed.inject(StalkerPortalRepairService);
    });

    afterEach(() => {
        Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: originalLockManager,
        });
    });

    describe('shouldAttemptRepair', () => {
        it('triggers on the middleware plain-text auth bodies', () => {
            expect(
                service.shouldAttemptRepair(
                    MISCLASSIFIED,
                    'Authorization failed.'
                )
            ).toBe(true);
            expect(
                service.shouldAttemptRepair(
                    MISCLASSIFIED,
                    'Unauthorized request.'
                )
            ).toBe(true);
        });

        it('triggers on HTTP 404 — the persisted endpoint does not exist', () => {
            expect(
                service.shouldAttemptRepair(MISCLASSIFIED, {
                    message: 'HTTP Error 404: Not Found',
                    status: 404,
                })
            ).toBe(true);
        });

        it('triggers on HTTP 401/403 — discovery classifies those endpoints as auth-required', () => {
            expect(
                service.shouldAttemptRepair(MISCLASSIFIED, {
                    message: 'HTTP Error 401: Unauthorized',
                    status: 401,
                })
            ).toBe(true);
            expect(
                service.shouldAttemptRepair(MISCLASSIFIED, {
                    message: 'HTTP Error 403: Forbidden',
                    status: 403,
                })
            ).toBe(true);
            // Endpoint-specific server errors are still not repair triggers.
            expect(
                service.shouldAttemptRepair(MISCLASSIFIED, {
                    message: 'HTTP Error 500: Internal Server Error',
                    status: 500,
                })
            ).toBe(false);
        });

        it('triggers on terminal session auth errors', () => {
            expect(
                service.shouldAttemptRepair(
                    MISCLASSIFIED,
                    new Error('Authorization failed after retry')
                )
            ).toBe(true);
            expect(
                service.shouldAttemptRepair(
                    MISCLASSIFIED,
                    new Error('Handshake failed: No token received')
                )
            ).toBe(true);
        });

        it.each([
            'Profile error: Access denied.',
            'Profile error: Unauthorized request.',
            'Profile error: Invalid token',
            'Profile error: Auth failed',
        ])('triggers on the wrapped profile denial %j', (message) => {
            // Authentication wraps structured denials; the trigger uses the
            // same failure set as discovery and the session service, so
            // these cannot bypass the repair.
            expect(
                service.shouldAttemptRepair(MISCLASSIFIED, new Error(message))
            ).toBe(true);
        });

        it('never triggers on timeouts or other network failures', () => {
            expect(
                service.shouldAttemptRepair(MISCLASSIFIED, {
                    type: 'ERROR',
                    message: 'timeout of 15000ms exceeded',
                    status: 500,
                })
            ).toBe(false);
            expect(service.shouldAttemptRepair(MISCLASSIFIED, { js: [] })).toBe(
                false
            );
        });

        it('never triggers for playlists without portal coordinates', () => {
            expect(
                service.shouldAttemptRepair(
                    { _id: 'x', macAddress: 'mac' } as PlaylistMeta,
                    'Authorization failed.'
                )
            ).toBe(false);
        });
    });

    describe('repairPortal', () => {
        it('does not preflight or discover while another tab owns the playlist authority', async () => {
            const request = jest.fn(
                async <T>(
                    name: string,
                    options: LockOptions,
                    callback: (lock: Lock | null) => Promise<T>
                ) => {
                    if (name === 'iptvnator:playlist-authority') {
                        return callback({
                            name,
                            mode: options.mode ?? 'shared',
                        } as Lock);
                    }
                    return callback(null);
                }
            );
            Object.defineProperty(globalThis.navigator, 'locks', {
                configurable: true,
                value: { request },
            });
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });

            await expect(
                service.repairPortal(MISCLASSIFIED)
            ).resolves.toBeNull();

            expect(getPlaylistById).not.toHaveBeenCalled();
            expect(beginPortalRepairDiscovery).not.toHaveBeenCalled();
            expect(discover).not.toHaveBeenCalled();
        });

        it('holds playlist authority from persisted preflight through the conditional commit', async () => {
            let rowAuthorityHeld = false;
            const request = jest.fn(
                async <T>(
                    name: string,
                    options: LockOptions,
                    callback: (lock: Lock | null) => Promise<T>
                ) => {
                    if (name === 'iptvnator:playlist-authority') {
                        return callback({ name, mode: 'shared' } as Lock);
                    }
                    rowAuthorityHeld = true;
                    try {
                        return await callback({
                            name,
                            mode: options.mode ?? 'exclusive',
                        } as Lock);
                    } finally {
                        rowAuthorityHeld = false;
                    }
                }
            );
            Object.defineProperty(globalThis.navigator, 'locks', {
                configurable: true,
                value: { request },
            });
            getPlaylistById.mockImplementation(() => {
                expect(rowAuthorityHeld).toBe(true);
                return of(persistedRow);
            });
            discover.mockImplementation(async () => {
                expect(rowAuthorityHeld).toBe(true);
                return {
                    status: 'resolved',
                    portalUrl: MISCLASSIFIED.portalUrl,
                    isFullStalkerPortal: true,
                    token: 'LOCKED_REPAIR_TOKEN',
                };
            });
            transformPlaylistMeta.mockImplementation((_id, transform) => {
                expect(rowAuthorityHeld).toBe(true);
                const next = transform(persistedRow) as Playlist;
                writtenRow = next;
                return of(next);
            });

            await expect(
                service.repairPortal(MISCLASSIFIED)
            ).resolves.toMatchObject({ isFullStalkerPortal: true });

            expect(rowAuthorityHeld).toBe(false);
            expect(request).toHaveBeenCalledWith(
                'iptvnator:playlist-authority',
                { mode: 'shared' },
                expect.any(Function)
            );
            expect(request).toHaveBeenCalledWith(
                `iptvnator:playlist-authority:${MISCLASSIFIED._id}`,
                { ifAvailable: true, mode: 'exclusive' },
                expect.any(Function)
            );
        });

        it('persists a proven different mode and returns the patched playlist', async () => {
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://ministra.example/server/load.php',
                isFullStalkerPortal: true,
                token: 'TOKEN1',
            });

            const repaired = await service.repairPortal(MISCLASSIFIED);

            expect(repaired).toMatchObject({
                _id: 'portal-1',
                portalUrl: 'http://ministra.example/server/load.php',
                isFullStalkerPortal: true,
            });
            // The atomic transform patched the FRESH row (verified inside
            // the write queue), so user state can never be clobbered.
            expect(writtenRow).toMatchObject({
                _id: 'portal-1',
                portalUrl: 'http://ministra.example/server/load.php',
                isFullStalkerPortal: true,
            });
            // The classification handshake already produced a session; it is
            // adopted whole (token + cadence), tagged with the REPAIRED
            // configuration as its identity source.
            expect(adoptDiscoveredSession).toHaveBeenCalledWith(
                'portal-1',
                expect.objectContaining({ _id: 'portal-1' }),
                expect.objectContaining({ token: 'TOKEN1' })
            );
            // A repaired ACTIVE playlist must re-sync the watchdog now: a
            // simple→full flip has to start the keepalive mid-session.
            expect(refreshActiveWatchdogPlaylist).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: 'portal-1',
                    isFullStalkerPortal: true,
                })
            );
        });

        it('repairs a dead portal.php endpoint to the canonical one', async () => {
            const wrongEndpoint = {
                ...MISCLASSIFIED,
                portalUrl: 'http://ministra.example/portal.php',
            } as PlaylistMeta;
            persistedRow = wrongEndpoint as Playlist;
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://ministra.example/server/load.php',
                isFullStalkerPortal: true,
                token: 'TOKEN2',
            });

            const repaired = await service.repairPortal(wrongEndpoint);

            expect(repaired?.portalUrl).toBe(
                'http://ministra.example/server/load.php'
            );
            expect(service.applyOverride(wrongEndpoint).portalUrl).toBe(
                'http://ministra.example/server/load.php'
            );
        });

        it('changes nothing when probing confirms the stored configuration', async () => {
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: false,
            });

            const repaired = await service.repairPortal(MISCLASSIFIED);

            expect(repaired).toBeNull();
            expect(writtenRow).toBeNull();
            expect(service.applyOverride(MISCLASSIFIED)).toBe(MISCLASSIFIED);
            expect(refreshActiveWatchdogPlaylist).not.toHaveBeenCalled();
        });

        it('changes nothing when the probe finds no working configuration', async () => {
            discover.mockResolvedValue({ status: 'unreachable' });

            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(writtenRow).toBeNull();
        });

        it('changes nothing when the probe is rejected by the portal', async () => {
            discover.mockResolvedValue({
                status: 'auth-rejected',
                portalUrl: MISCLASSIFIED.portalUrl,
            });

            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(writtenRow).toBeNull();
        });

        it('keeps repair authentication fenced until an abandoned attempt settles', async () => {
            let settleAuthentication: () => void = () => undefined;
            const abandonedAuthenticationSettled = new Promise<void>(
                (resolve) => {
                    settleAuthentication = resolve;
                }
            );
            discover.mockResolvedValue({
                status: 'auth-rejected',
                portalUrl: MISCLASSIFIED.portalUrl,
                abandonedInFlight: true,
                abandonedAuthenticationSettled,
            });

            const repair = service.repairPortal(MISCLASSIFIED);
            while (discover.mock.calls.length === 0) {
                await Promise.resolve();
            }
            let repairSettled = false;
            void repair.then(() => {
                repairSettled = true;
            });
            for (let i = 0; i < 5; i += 1) {
                await Promise.resolve();
            }

            expect(repairSettled).toBe(false);
            expect(beginPortalRepairDiscovery).toHaveBeenCalledWith(
                MISCLASSIFIED._id
            );
            expect(completePortalRepairDiscovery).not.toHaveBeenCalled();

            const waitingForRepair = service.waitForPendingRepair(
                MISCLASSIFIED._id
            );
            settleAuthentication();
            await expect(repair).resolves.toBeNull();
            await expect(waitingForRepair).resolves.toBeUndefined();
            expect(completePortalRepairDiscovery).toHaveBeenCalledWith(
                expect.objectContaining({ playlistId: MISCLASSIFIED._id })
            );
        });

        it('discards a repair whose credentials changed while probing', async () => {
            // Discovery can run for tens of seconds; a login saved meanwhile
            // means the outcome was negotiated for an account the row no
            // longer belongs to, so committing it would adopt the wrong
            // session.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://panel.example/server/load.php',
                isFullStalkerPortal: true,
                token: 'WRONG-ACCOUNT',
            });
            // The row the transform sees carries the NEW login.
            persistedRow = {
                ...MISCLASSIFIED,
                username: 'edited-mid-probe',
            } as Playlist;

            expect(
                await service.repairPortal({
                    ...MISCLASSIFIED,
                    username: 'original',
                })
            ).toBeNull();
            expect(writtenRow).toBeNull();
            expect(adoptDiscoveredSession).not.toHaveBeenCalled();
        });

        it('adopts the cadence the repair confirmation discovered', async () => {
            // Caching the token alone satisfies the retry, so NO
            // authentication path would ever apply the profile outcome — the
            // repaired playlist would keep the default cadence until the
            // token failed or the app restarted.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://panel.example/server/load.php',
                isFullStalkerPortal: true,
                token: 'REPAIRED',
                watchdogTimeoutSeconds: 60,
                timeslotSeconds: 9,
            });

            await service.repairPortal(MISCLASSIFIED);

            expect(adoptDiscoveredSession).toHaveBeenCalledWith(
                MISCLASSIFIED._id,
                expect.objectContaining({
                    portalUrl: 'http://panel.example/server/load.php',
                }),
                {
                    token: 'REPAIRED',
                    watchdogTimeoutSeconds: 60,
                    timeslotSeconds: 9,
                }
            );
        });

        it("forwards the playlist's stored credentials to discovery", async () => {
            // A login/password portal answers status 2 during confirmation;
            // without the credentials the probe reports `login-required` and
            // the source could never be repaired.
            discover.mockResolvedValue({ status: 'unreachable' });
            const playlistWithCredentials = {
                ...MISCLASSIFIED,
                username: 'user',
                password: 'secret',
            } as PlaylistMeta;
            persistedRow = playlistWithCredentials as Playlist;

            await service.repairPortal(playlistWithCredentials);

            expect(discover).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(Object),
                { credentials: { username: 'user', password: 'secret' } }
            );
        });

        it('probes at most once per playlist per session', async () => {
            discover.mockResolvedValue({ status: 'unreachable' });

            await service.repairPortal(MISCLASSIFIED);
            await service.repairPortal(MISCLASSIFIED);

            expect(discover).toHaveBeenCalledTimes(1);
        });

        it('re-enters for an edited configuration after declining a pending stale source', async () => {
            // A's persisted-row preflight is in flight when a request from
            // the EDITED config B fails: after stale A is declined, B must
            // get its own probe instead of inheriting A's outcome.
            const edited = {
                ...MISCLASSIFIED,
                portalUrl: 'http://edited.example/portal.php',
            } as PlaylistMeta;
            persistedRow = edited as Playlist;

            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://edited.example/server/load.php',
                isFullStalkerPortal: true,
            });

            const oldRepair = service.repairPortal(MISCLASSIFIED);
            const editedRepair = service.repairPortal(edited);

            expect(await oldRepair).toBeNull();
            const repaired = await editedRepair;
            expect(discover).toHaveBeenCalledTimes(1);
            expect(repaired?.portalUrl).toBe(
                'http://edited.example/server/load.php'
            );
        });

        it('shares one in-flight probe between concurrent failing requests', async () => {
            let resolveDiscovery!: (value: unknown) => void;
            discover.mockReturnValue(
                new Promise((resolve) => (resolveDiscovery = resolve))
            );

            const first = service.repairPortal(MISCLASSIFIED);
            const second = service.repairPortal(MISCLASSIFIED);
            resolveDiscovery({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });

            const [a, b] = await Promise.all([first, second]);
            expect(discover).toHaveBeenCalledTimes(1);
            expect(a?.isFullStalkerPortal).toBe(true);
            expect(b?.isFullStalkerPortal).toBe(true);
        });

        it('hands out the completed override to later failing callers without re-probing', async () => {
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });

            await service.repairPortal(MISCLASSIFIED);
            // A caller still holding the stale playlist object fails and asks
            // again: it gets the override without a second probe.
            const again = await service.repairPortal(MISCLASSIFIED);

            expect(discover).toHaveBeenCalledTimes(1);
            expect(again?.isFullStalkerPortal).toBe(true);

            // A caller already on the repaired configuration gets null — its
            // failure has another cause, and retrying would loop.
            const alreadyApplied = service.applyOverride(MISCLASSIFIED);
            expect(await service.repairPortal(alreadyApplied)).toBeNull();
        });

        it('drops the override and re-arms probing when the user edits portal metadata', async () => {
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            await service.repairPortal(MISCLASSIFIED);
            expect(service.applyOverride(MISCLASSIFIED)).toMatchObject({
                isFullStalkerPortal: true,
            });

            // The user pointed the playlist somewhere else through the
            // playlist dialog: the ID-keyed override must not keep rewriting
            // requests to the old repaired endpoint.
            const edited = {
                ...MISCLASSIFIED,
                portalUrl: 'http://other.example/portal.php',
            } as PlaylistMeta;
            persistedRow = edited as Playlist;
            expect(service.applyOverride(edited)).toBe(edited);
            await flushMicrotasks();

            // …and the once-per-session latch re-arms so the EDITED
            // configuration may probe if it fails too.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://other.example/server/load.php',
                isFullStalkerPortal: true,
            });
            const repairedAgain = await service.repairPortal(edited);
            expect(discover).toHaveBeenCalledTimes(2);
            expect(repairedAgain?.portalUrl).toBe(
                'http://other.example/server/load.php'
            );
        });

        it('fences an edit without changing runtime state until persistence commits', async () => {
            const wrongEndpoint = {
                ...MISCLASSIFIED,
                portalUrl: 'http://ministra.example/portal.php',
            } as PlaylistMeta;
            persistedRow = wrongEndpoint as Playlist;
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://ministra.example/server/load.php',
                isFullStalkerPortal: true,
                token: 'TOKEN2',
            });
            await service.repairPortal(wrongEndpoint);
            clearCachedToken.mockClear();

            service.fenceForPlaylistEdit(wrongEndpoint._id);

            expect(service.applyOverride(wrongEndpoint).portalUrl).toBe(
                'http://ministra.example/server/load.php'
            );
            expect(clearCachedToken).not.toHaveBeenCalled();

            service.commitPlaylistEdit(wrongEndpoint._id);

            expect(service.applyOverride(wrongEndpoint)).toBe(wrongEndpoint);
            expect(clearCachedToken).not.toHaveBeenCalled();
        });

        it('does not start another repair while explicit Edit discovery owns the playlist', async () => {
            const fence = service.fenceForPlaylistEdit(MISCLASSIFIED._id);
            discover.mockClear();

            await expect(
                service.repairPortal(MISCLASSIFIED)
            ).resolves.toBeNull();
            expect(discover).not.toHaveBeenCalled();

            service.releasePlaylistEdit(MISCLASSIFIED._id);
            await fence;
        });

        it('does not probe a stale source after explicit Edit has committed', async () => {
            const edited = {
                ...MISCLASSIFIED,
                portalUrl: 'http://edited.example/server/load.php',
                isFullStalkerPortal: true,
            } as Playlist;
            await service.fenceForPlaylistEdit(MISCLASSIFIED._id);
            persistedRow = edited;
            service.commitPlaylistEdit(MISCLASSIFIED._id);
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
                token: 'STALE_REPAIR_TOKEN',
            });

            await expect(
                service.repairPortal(MISCLASSIFIED)
            ).resolves.toBeNull();
            expect(discover).not.toHaveBeenCalled();
            expect(adoptDiscoveredSession).not.toHaveBeenCalled();
        });

        it('discards a repair verified before explicit Edit but completed after it', async () => {
            const wrongEndpoint = {
                ...MISCLASSIFIED,
                portalUrl: 'http://ministra.example/portal.php',
            } as PlaylistMeta;
            persistedRow = wrongEndpoint as Playlist;
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://ministra.example/server/load.php',
                isFullStalkerPortal: true,
                token: 'REPAIR_TOKEN',
            });
            const writeCompletion = new Subject<Playlist | null>();
            transformPlaylistMeta.mockImplementation((_id, transform) => {
                writtenRow = transform(persistedRow) as Playlist | null;
                return writeCompletion;
            });

            const repair = service.repairPortal(wrongEndpoint);
            while (transformPlaylistMeta.mock.calls.length === 0) {
                await Promise.resolve();
            }
            // The transform has verified A and computed B, but its async
            // persistence has not completed. Explicit Edit C must fence all
            // repair-side runtime/session effects that follow that await.
            service.fenceForPlaylistEdit(wrongEndpoint._id);
            writeCompletion.next(writtenRow);

            await expect(repair).resolves.toBeNull();
            expect(service.applyOverride(wrongEndpoint)).toBe(wrongEndpoint);
            expect(adoptDiscoveredSession).not.toHaveBeenCalled();
            expect(refreshActiveWatchdogPlaylist).not.toHaveBeenCalled();
        });

        it('discards an in-flight repair when the row was edited during the probe', async () => {
            // The probe can run for tens of seconds; a user who saves a new
            // portal URL meanwhile must win over the repair of the old one.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            persistedRow = {
                ...MISCLASSIFIED,
                portalUrl: 'http://edited.example/portal.php',
            } as Playlist;

            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(writtenRow).toBeNull();
            expect(refreshActiveWatchdogPlaylist).not.toHaveBeenCalled();
            expect(service.applyOverride(MISCLASSIFIED)).toBe(MISCLASSIFIED);
        });

        it('discards an in-flight repair when the MAC or identity changed during the probe', async () => {
            // The probe authenticated AS an identity — a token and watchdog
            // for the old MAC must not be installed onto the edited account.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            persistedRow = {
                ...MISCLASSIFIED,
                macAddress: '00:1A:79:00:99:99',
            } as Playlist;

            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(writtenRow).toBeNull();
            expect(adoptDiscoveredSession).not.toHaveBeenCalled();
            expect(refreshActiveWatchdogPlaylist).not.toHaveBeenCalled();
        });

        it('never aliases distinct identities across field boundaries', async () => {
            // Delimiter-style fingerprints would treat serial "a|b" +
            // empty device as equal to serial "a" + device "b" and skip
            // the identity invalidation entirely.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            const pipedIdentity = {
                ...MISCLASSIFIED,
                stalkerSerialNumber: 'a|b',
            } as PlaylistMeta;
            persistedRow = pipedIdentity as Playlist;
            await service.repairPortal(pipedIdentity);
            clearCachedToken.mockClear();

            const shiftedIdentity = {
                ...MISCLASSIFIED,
                stalkerSerialNumber: 'a',
                stalkerDeviceId1: 'b',
            } as PlaylistMeta;
            persistedRow = shiftedIdentity as Playlist;

            // A DIFFERENT identity must invalidate, not inherit.
            expect(service.applyOverride(shiftedIdentity)).toBe(
                shiftedIdentity
            );
            await flushMicrotasks();
            expect(clearCachedToken).toHaveBeenCalledWith('portal-1');
        });

        it('reinstalls the remembered repair when a restored configuration fails again', async () => {
            // Repair A, edit to B (drops the active override), restore A:
            // A's next failure must reinstall the remembered outcome
            // WITHOUT a second discovery — not stay broken until restart.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            await service.repairPortal(MISCLASSIFIED);
            expect(discover).toHaveBeenCalledTimes(1);

            const editedIdentity = {
                ...MISCLASSIFIED,
                macAddress: '00:1A:79:00:44:44',
            } as PlaylistMeta;
            // The edit drops the active override…
            persistedRow = editedIdentity as Playlist;
            expect(service.applyOverride(editedIdentity)).toBe(editedIdentity);
            await flushMicrotasks();
            expect(service.applyOverride(MISCLASSIFIED)).toBe(MISCLASSIFIED);

            // …and the restored configuration reinstalls it on failure.
            persistedRow = MISCLASSIFIED as Playlist;
            refreshActiveWatchdogPlaylist.mockClear();
            const restored = await service.repairPortal(MISCLASSIFIED);
            expect(discover).toHaveBeenCalledTimes(1);
            expect(restored).toMatchObject({ isFullStalkerPortal: true });
            expect(service.applyOverride(MISCLASSIFIED)).toMatchObject({
                isFullStalkerPortal: true,
            });
            // The reinstall re-syncs the watchdog exactly like a fresh
            // repair — the intermediate edit may have stopped the keepalive.
            expect(refreshActiveWatchdogPlaylist).toHaveBeenCalledWith(
                expect.objectContaining({ isFullStalkerPortal: true })
            );
        });

        it('does not resurrect a remembered override while the row holds another config', async () => {
            // Repair A→B, then the user edits the row to an unrelated C. A
            // stale A request failing afterwards must NOT reinstall B (it
            // would retry against B and repoint the watchdog away from C).
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://b.example/server/load.php',
                isFullStalkerPortal: true,
            });
            await service.repairPortal(MISCLASSIFIED);

            const otherConfig = {
                ...MISCLASSIFIED,
                portalUrl: 'http://c.example/portal.php',
            } as PlaylistMeta;
            // The edit drops the active override…
            persistedRow = otherConfig as Playlist;
            expect(service.applyOverride(otherConfig)).toBe(otherConfig);
            await flushMicrotasks();
            refreshActiveWatchdogPlaylist.mockClear();

            // …and a stale A request does not bring it back.
            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(service.applyOverride(MISCLASSIFIED)).toBe(MISCLASSIFIED);
            expect(refreshActiveWatchdogPlaylist).not.toHaveBeenCalled();
        });

        it('drops the override and the cached token when only the identity was edited', async () => {
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            await service.repairPortal(MISCLASSIFIED);
            expect(service.applyOverride(MISCLASSIFIED)).toMatchObject({
                isFullStalkerPortal: true,
            });
            clearCachedToken.mockClear();

            // Same URL and mode, different MAC: the repair token belongs to
            // the previous identity and must be retired with the override.
            const editedIdentity = {
                ...MISCLASSIFIED,
                macAddress: '00:1A:79:00:88:88',
            } as PlaylistMeta;

            persistedRow = editedIdentity as Playlist;
            expect(service.applyOverride(editedIdentity)).toBe(editedIdentity);
            await flushMicrotasks();
            expect(clearCachedToken).toHaveBeenCalledWith('portal-1');
            // The latch is re-armed for the edited identity.
            discover.mockClear();
            discover.mockResolvedValue({ status: 'unreachable' });
            await service.repairPortal(editedIdentity);
            expect(discover).toHaveBeenCalledTimes(1);
        });

        it('drops a repaired override when a restored row has new credentials', async () => {
            const original = {
                ...MISCLASSIFIED,
                username: 'user-1',
                password: 'password-1',
            } as PlaylistMeta;
            persistedRow = original as Playlist;
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: original.portalUrl,
                isFullStalkerPortal: true,
            });
            await service.repairPortal(original);
            clearCachedToken.mockClear();

            const restored = {
                ...original,
                username: 'user-2',
                password: 'password-2',
            } as PlaylistMeta;
            persistedRow = restored as Playlist;

            expect(service.applyOverride(restored)).toBe(restored);
            await flushMicrotasks();
            expect(clearCachedToken).toHaveBeenCalledWith(original._id);

            discover.mockResolvedValue({ status: 'unreachable' });
            await service.repairPortal(restored);
            expect(discover).toHaveBeenCalledTimes(2);
        });

        it('keeps a valid override when only a delayed snapshot has stale credentials', async () => {
            const current = {
                ...MISCLASSIFIED,
                username: 'current-user',
                password: 'current-password',
            } as PlaylistMeta;
            persistedRow = current as Playlist;
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: current.portalUrl,
                isFullStalkerPortal: true,
            });
            await service.repairPortal(current);
            persistedRow = writtenRow as Playlist;
            clearCachedToken.mockClear();

            const delayed = {
                ...current,
                username: 'stale-user',
                password: 'stale-password',
            } as PlaylistMeta;
            expect(service.applyOverride(delayed)).toBe(delayed);
            await flushMicrotasks();

            expect(clearCachedToken).not.toHaveBeenCalled();
            expect(service.applyOverride(current)).toMatchObject({
                isFullStalkerPortal: true,
            });
        });

        it.each(['before', 'after'] as const)(
            'does not retire a token when its row read starts %s an explicit edit takes ownership',
            async (readOrder) => {
                const original = {
                    ...MISCLASSIFIED,
                    username: 'repair-user',
                    password: 'repair-password',
                } as PlaylistMeta;
                persistedRow = original as Playlist;
                discover.mockResolvedValue({
                    status: 'resolved',
                    portalUrl: original.portalUrl,
                    isFullStalkerPortal: true,
                    token: 'REPAIR_TOKEN',
                });
                await service.repairPortal(original);
                clearCachedToken.mockClear();

                const edited = {
                    ...original,
                    username: 'edited-user',
                    password: 'edited-password',
                } as PlaylistMeta;
                const rowRead = new Subject<Playlist | undefined>();
                getPlaylistById.mockReturnValueOnce(rowRead);

                if (readOrder === 'before') {
                    expect(service.applyOverride(edited)).toBe(edited);
                }
                // A confirmation may have started just before Edit, or a
                // delayed caller may start it while Edit owns the ID.
                await service.fenceForPlaylistEdit(original._id);
                if (readOrder === 'after') {
                    expect(service.applyOverride(edited)).toBe(edited);
                }

                setCachedToken(original._id, 'EDIT_TOKEN', edited);
                rowRead.next(edited as Playlist);
                rowRead.complete();
                await flushMicrotasks();

                expect(clearCachedToken).not.toHaveBeenCalled();
                service.commitPlaylistEdit(original._id);
                expect(service.applyOverride(original)).toBe(original);
            }
        );

        it('re-probes a DISCARDED configuration once the row is restored to it', async () => {
            // A's probe was discarded by the persisted-row preflight because
            // the row had moved to B; after the user restores the row to A,
            // A's next failure must probe instead of staying dead.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            persistedRow = {
                ...MISCLASSIFIED,
                portalUrl: 'http://edited.example/portal.php',
            } as Playlist;
            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(discover).not.toHaveBeenCalled();

            // Row restored to A → the discarded marker yields to a new probe.
            persistedRow = MISCLASSIFIED as Playlist;
            const repaired = await service.repairPortal(MISCLASSIFIED);
            expect(discover).toHaveBeenCalledTimes(1);
            expect(repaired).toMatchObject({ isFullStalkerPortal: true });
        });

        it('does not start discovery when Edit takes ownership during a DISCARDED history read', async () => {
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            persistedRow = {
                ...MISCLASSIFIED,
                portalUrl: 'http://edited.example/portal.php',
            } as Playlist;
            await service.repairPortal(MISCLASSIFIED);
            expect(discover).not.toHaveBeenCalled();

            persistedRow = MISCLASSIFIED as Playlist;
            const historyRead = new Subject<Playlist | undefined>();
            getPlaylistById.mockClear();
            getPlaylistById.mockReturnValueOnce(historyRead);
            beginPortalRepairDiscovery.mockClear();
            completePortalRepairDiscovery.mockClear();

            const repair = service.repairPortal(MISCLASSIFIED);
            while (getPlaylistById.mock.calls.length === 0) {
                await Promise.resolve();
            }
            expect(getPlaylistById).toHaveBeenCalledTimes(1);
            // Edit installs its generation fence immediately, then drains
            // the published repair owner while the row read is still live.
            const editDrain = service.fenceForPlaylistEdit(MISCLASSIFIED._id);
            historyRead.next(MISCLASSIFIED as Playlist);
            historyRead.complete();

            await expect(repair).resolves.toBeNull();
            await editDrain;
            expect(beginPortalRepairDiscovery).not.toHaveBeenCalled();
            expect(discover).not.toHaveBeenCalled();

            // A failed/cancelled Edit releases the fence without consuming
            // the discarded history record; the restored source can retry.
            service.releasePlaylistEdit(MISCLASSIFIED._id);
            await expect(
                service.repairPortal(MISCLASSIFIED)
            ).resolves.toMatchObject({ isFullStalkerPortal: true });
            expect(discover).toHaveBeenCalledTimes(1);
        });

        it('re-arms the EDITED configuration after a mid-probe edit discarded a repair', async () => {
            const edited = {
                ...MISCLASSIFIED,
                portalUrl: 'http://edited.example/portal.php',
            } as PlaylistMeta;

            // The OLD config is declined before discovery because the row
            // already carries the user edit.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            persistedRow = edited as Playlist;
            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(discover).not.toHaveBeenCalled();

            // A stale snapshot of the already-probed config must NOT loop
            // the probe…
            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(discover).not.toHaveBeenCalled();

            // …but the EDITED configuration failing later must be allowed
            // to repair without an application restart.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://edited.example/server/load.php',
                isFullStalkerPortal: true,
            });
            const repaired = await service.repairPortal(edited);
            expect(discover).toHaveBeenCalledTimes(1);
            expect(repaired?.portalUrl).toBe(
                'http://edited.example/server/load.php'
            );
        });

        it('discards an in-flight repair when the playlist was deleted during the probe', async () => {
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            persistedRow = undefined;

            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(writtenRow).toBeNull();
        });

        it('keeps the session-only override when persisting fails', async () => {
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            // The transform verified the row, but the WRITE failed.
            persistError = new Error('db locked');

            const repaired = await service.repairPortal(MISCLASSIFIED);

            expect(repaired?.isFullStalkerPortal).toBe(true);
            expect(
                service.applyOverride(MISCLASSIFIED).isFullStalkerPortal
            ).toBe(true);
        });

        it('clears a stale cached token when a portal turns out token-free', async () => {
            const wronglyFull = {
                ...MISCLASSIFIED,
                portalUrl: 'http://panel.example/server/load.php',
                isFullStalkerPortal: true,
            } as PlaylistMeta;
            persistedRow = wronglyFull as Playlist;
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://panel.example/portal.php',
                isFullStalkerPortal: false,
            });

            const repaired = await service.repairPortal(wronglyFull);

            expect(repaired?.isFullStalkerPortal).toBe(false);
            expect(adoptDiscoveredSimplePortal).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: 'portal-1',
                    portalUrl: 'http://panel.example/portal.php',
                    isFullStalkerPortal: false,
                })
            );
        });
    });
});
