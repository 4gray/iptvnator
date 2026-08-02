import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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

describe('StalkerPortalRepairService', () => {
    let service: StalkerPortalRepairService;
    let discover: jest.Mock;
    let transformPlaylistMeta: jest.Mock;
    /** What the persisted row looks like when the repair re-verifies it. */
    let persistedRow: Playlist | undefined;
    /** The row the atomic transform actually wrote, if any. */
    let writtenRow: Playlist | null;
    /** When set, the atomic write fails AFTER the transform verified. */
    let persistError: Error | null;
    let setCachedToken: jest.Mock;
    let clearCachedToken: jest.Mock;
    let refreshActiveWatchdogPlaylist: jest.Mock;

    beforeEach(() => {
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
        setCachedToken = jest.fn();
        clearCachedToken = jest.fn();
        refreshActiveWatchdogPlaylist = jest.fn();

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
                        getPlaylistById: jest.fn(() => of(persistedRow)),
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        setCachedToken,
                        clearCachedToken,
                        refreshActiveWatchdogPlaylist,
                    },
                },
            ],
        });

        service = TestBed.inject(StalkerPortalRepairService);
    });

    describe('shouldAttemptRepair', () => {
        it('triggers on the middleware plain-text auth bodies', () => {
            expect(
                service.shouldAttemptRepair(MISCLASSIFIED, 'Authorization failed.')
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

        it('never triggers on timeouts or other network failures', () => {
            expect(
                service.shouldAttemptRepair(MISCLASSIFIED, {
                    type: 'ERROR',
                    message: 'timeout of 15000ms exceeded',
                    status: 500,
                })
            ).toBe(false);
            expect(
                service.shouldAttemptRepair(MISCLASSIFIED, { js: [] })
            ).toBe(false);
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
            // The classification handshake already produced a token,
            // tagged with the playlist as its identity source.
            expect(setCachedToken).toHaveBeenCalledWith(
                'portal-1',
                'TOKEN1',
                expect.objectContaining({ _id: 'portal-1' })
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

        it('probes at most once per playlist per session', async () => {
            discover.mockResolvedValue({ status: 'unreachable' });

            await service.repairPortal(MISCLASSIFIED);
            await service.repairPortal(MISCLASSIFIED);

            expect(discover).toHaveBeenCalledTimes(1);
        });

        it('re-enters for an edited configuration after awaiting a pending probe', async () => {
            // A's probe is in flight when a request from the EDITED config B
            // fails: after A settles (and is discarded by the row guard), B
            // must get its own probe instead of inheriting A's outcome.
            const edited = {
                ...MISCLASSIFIED,
                portalUrl: 'http://edited.example/portal.php',
            } as PlaylistMeta;
            persistedRow = edited as Playlist;

            let resolveFirstDiscovery!: (value: unknown) => void;
            discover.mockReturnValueOnce(
                new Promise((resolve) => (resolveFirstDiscovery = resolve))
            );
            discover.mockResolvedValueOnce({
                status: 'resolved',
                portalUrl: 'http://edited.example/server/load.php',
                isFullStalkerPortal: true,
            });

            const oldRepair = service.repairPortal(MISCLASSIFIED);
            const editedRepair = service.repairPortal(edited);

            resolveFirstDiscovery({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });

            expect(await oldRepair).toBeNull();
            const repaired = await editedRepair;
            expect(discover).toHaveBeenCalledTimes(2);
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
            expect(service.applyOverride(edited)).toBe(edited);

            // …and the once-per-session latch re-arms so the EDITED
            // configuration may probe if it fails too.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://other.example/server/load.php',
                isFullStalkerPortal: true,
            });
            persistedRow = edited as Playlist;
            const repairedAgain = await service.repairPortal(edited);
            expect(discover).toHaveBeenCalledTimes(2);
            expect(repairedAgain?.portalUrl).toBe(
                'http://other.example/server/load.php'
            );
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
            expect(setCachedToken).not.toHaveBeenCalled();
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

            // A DIFFERENT identity must invalidate, not inherit.
            expect(service.applyOverride(shiftedIdentity)).toBe(
                shiftedIdentity
            );
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
            expect(service.applyOverride(editedIdentity)).toBe(editedIdentity);
            expect(service.applyOverride(MISCLASSIFIED)).toBe(MISCLASSIFIED);

            // …and the restored configuration reinstalls it on failure.
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
            expect(service.applyOverride(otherConfig)).toBe(otherConfig);
            persistedRow = otherConfig as Playlist;
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

            expect(service.applyOverride(editedIdentity)).toBe(editedIdentity);
            expect(clearCachedToken).toHaveBeenCalledWith('portal-1');
            // The latch is re-armed for the edited identity.
            discover.mockClear();
            discover.mockResolvedValue({ status: 'unreachable' });
            persistedRow = editedIdentity as Playlist;
            await service.repairPortal(editedIdentity);
            expect(discover).toHaveBeenCalledTimes(1);
        });

        it('re-probes a DISCARDED configuration once the row is restored to it', async () => {
            // A's probe was discarded because the row moved to B mid-probe;
            // after the user restores the row to A, A's next failure must
            // probe again instead of staying dead for the session.
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
            expect(discover).toHaveBeenCalledTimes(1);

            // Row restored to A → the discarded marker yields to a new probe.
            persistedRow = MISCLASSIFIED as Playlist;
            const repaired = await service.repairPortal(MISCLASSIFIED);
            expect(discover).toHaveBeenCalledTimes(2);
            expect(repaired).toMatchObject({ isFullStalkerPortal: true });
        });

        it('re-arms the EDITED configuration after a mid-probe edit discarded a repair', async () => {
            const edited = {
                ...MISCLASSIFIED,
                portalUrl: 'http://edited.example/portal.php',
            } as PlaylistMeta;

            // Probe of the OLD config lands after the user edit → discarded.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            persistedRow = edited as Playlist;
            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(discover).toHaveBeenCalledTimes(1);

            // A stale snapshot of the already-probed config must NOT loop
            // the probe…
            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(discover).toHaveBeenCalledTimes(1);

            // …but the EDITED configuration failing later must be allowed
            // to repair without an application restart.
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: 'http://edited.example/server/load.php',
                isFullStalkerPortal: true,
            });
            const repaired = await service.repairPortal(edited);
            expect(discover).toHaveBeenCalledTimes(2);
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
            expect(service.applyOverride(MISCLASSIFIED).isFullStalkerPortal).toBe(
                true
            );
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
            expect(clearCachedToken).toHaveBeenCalledWith('portal-1');
        });
    });
});
