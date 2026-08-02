import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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
    let updatePlaylistMeta: jest.Mock;
    let setCachedToken: jest.Mock;
    let clearCachedToken: jest.Mock;
    let refreshActiveWatchdogPlaylist: jest.Mock;

    beforeEach(() => {
        discover = jest.fn();
        updatePlaylistMeta = jest.fn().mockReturnValue(of({}));
        setCachedToken = jest.fn();
        clearCachedToken = jest.fn();
        refreshActiveWatchdogPlaylist = jest.fn();

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: StalkerPortalDiscoveryService,
                    useValue: { discover },
                },
                { provide: PlaylistsService, useValue: { updatePlaylistMeta } },
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
                    message: 'HTTP Error: Not Found',
                    status: 404,
                })
            ).toBe(true);
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
            // Minimal patch: only the identity plus the two repaired fields,
            // so a stale in-memory meta can never clobber user state.
            expect(updatePlaylistMeta).toHaveBeenCalledWith({
                _id: 'portal-1',
                portalUrl: 'http://ministra.example/server/load.php',
                isFullStalkerPortal: true,
            });
            // The classification handshake already produced a token.
            expect(setCachedToken).toHaveBeenCalledWith('portal-1', 'TOKEN1');
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
            expect(updatePlaylistMeta).not.toHaveBeenCalled();
            expect(service.applyOverride(MISCLASSIFIED)).toBe(MISCLASSIFIED);
            expect(refreshActiveWatchdogPlaylist).not.toHaveBeenCalled();
        });

        it('changes nothing when the probe finds no working configuration', async () => {
            discover.mockResolvedValue({ status: 'unreachable' });

            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(updatePlaylistMeta).not.toHaveBeenCalled();
        });

        it('changes nothing when the probe is rejected by the portal', async () => {
            discover.mockResolvedValue({
                status: 'auth-rejected',
                portalUrl: MISCLASSIFIED.portalUrl,
            });

            expect(await service.repairPortal(MISCLASSIFIED)).toBeNull();
            expect(updatePlaylistMeta).not.toHaveBeenCalled();
        });

        it('probes at most once per playlist per session', async () => {
            discover.mockResolvedValue({ status: 'unreachable' });

            await service.repairPortal(MISCLASSIFIED);
            await service.repairPortal(MISCLASSIFIED);

            expect(discover).toHaveBeenCalledTimes(1);
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
            const repairedAgain = await service.repairPortal(edited);
            expect(discover).toHaveBeenCalledTimes(2);
            expect(repairedAgain?.portalUrl).toBe(
                'http://other.example/server/load.php'
            );
        });

        it('keeps the session-only override when persisting fails', async () => {
            discover.mockResolvedValue({
                status: 'resolved',
                portalUrl: MISCLASSIFIED.portalUrl,
                isFullStalkerPortal: true,
            });
            updatePlaylistMeta.mockReturnValue(
                throwError(() => new Error('db locked'))
            );

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
