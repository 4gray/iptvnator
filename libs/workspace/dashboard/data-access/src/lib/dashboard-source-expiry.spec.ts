import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PlaylistsService, PortalStatusService } from '@iptvnator/services';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { DashboardSourceExpiryService } from './dashboard-source-expiry.service';
import {
    SOURCE_EXPIRY_WARNING_DAYS,
    resolveSourceExpiryBadge,
} from './dashboard-source-expiry.util';

const DAY_SECONDS = 86_400;

describe('resolveSourceExpiryBadge', () => {
    const nowMs = Date.UTC(2026, 7, 1, 12, 0, 0);
    const nowSeconds = nowMs / 1000;

    it('returns null without facts', () => {
        expect(resolveSourceExpiryBadge(null, nowMs)).toBeNull();
        expect(resolveSourceExpiryBadge(undefined, nowMs)).toBeNull();
    });

    it('returns expired when the portal reports an expired account without a timestamp', () => {
        expect(
            resolveSourceExpiryBadge(
                { expiresAtSeconds: null, reportedExpired: true },
                nowMs
            )
        ).toEqual({ kind: 'expired' });
    });

    it('returns expired for timestamps in the past', () => {
        expect(
            resolveSourceExpiryBadge(
                { expiresAtSeconds: nowSeconds - 60, reportedExpired: false },
                nowMs
            )
        ).toEqual({ kind: 'expired' });
    });

    it('warns with ceil-ed days inside the warning window', () => {
        expect(
            resolveSourceExpiryBadge(
                {
                    expiresAtSeconds: nowSeconds + 2.5 * DAY_SECONDS,
                    reportedExpired: false,
                },
                nowMs
            )
        ).toEqual({ kind: 'expiring', daysLeft: 3 });
    });

    it('includes the boundary day but not one hour past it', () => {
        expect(
            resolveSourceExpiryBadge(
                {
                    expiresAtSeconds:
                        nowSeconds + SOURCE_EXPIRY_WARNING_DAYS * DAY_SECONDS,
                    reportedExpired: false,
                },
                nowMs
            )
        ).toEqual({ kind: 'expiring', daysLeft: SOURCE_EXPIRY_WARNING_DAYS });

        expect(
            resolveSourceExpiryBadge(
                {
                    expiresAtSeconds:
                        nowSeconds +
                        SOURCE_EXPIRY_WARNING_DAYS * DAY_SECONDS +
                        3600,
                    reportedExpired: false,
                },
                nowMs
            )
        ).toBeNull();
    });

    it('treats unknown and sentinel expirations as no badge', () => {
        expect(
            resolveSourceExpiryBadge(
                { expiresAtSeconds: null, reportedExpired: false },
                nowMs
            )
        ).toBeNull();
        expect(
            resolveSourceExpiryBadge(
                { expiresAtSeconds: 0, reportedExpired: false },
                nowMs
            )
        ).toBeNull();
    });
});

describe('DashboardSourceExpiryService', () => {
    let service: DashboardSourceExpiryService;
    let portalStatusService: { checkPortalStatusDetails: jest.Mock };
    let playlistsService: { getPlaylistById: jest.Mock };

    const xtreamPlaylist = {
        _id: 'xtream-1',
        title: 'Xtream',
        serverUrl: 'https://provider.example.test',
        username: 'demo',
        password: 'secret',
    } as PlaylistMeta;

    const stalkerPlaylist = {
        _id: 'stalker-1',
        title: 'Stalker',
        portalUrl: 'https://stalker.example.test/portal.php',
        macAddress: '00:1A:79:00:00:01',
        updateDate: 1_750_000_000_000,
    } as PlaylistMeta;

    const m3uPlaylist = {
        _id: 'm3u-1',
        title: 'M3U',
        url: 'https://example.com/playlist.m3u',
    } as PlaylistMeta;

    beforeEach(() => {
        portalStatusService = { checkPortalStatusDetails: jest.fn() };
        playlistsService = { getPlaylistById: jest.fn() };

        TestBed.configureTestingModule({
            providers: [
                DashboardSourceExpiryService,
                {
                    provide: PortalStatusService,
                    useValue: portalStatusService,
                },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        });
        service = TestBed.inject(DashboardSourceExpiryService);
    });

    afterEach(() => {
        TestBed.resetTestingModule();
    });

    it('collects Xtream facts from the shared status details', async () => {
        const expiresAtSeconds = Math.floor(Date.now() / 1000) + 3 * DAY_SECONDS;
        portalStatusService.checkPortalStatusDetails.mockResolvedValue({
            status: 'active',
            expiresAtSeconds,
        });

        await service.refresh([xtreamPlaylist]);

        expect(service.facts().get('xtream-1')).toEqual({
            expiresAtSeconds,
            reportedExpired: false,
        });
        expect(
            portalStatusService.checkPortalStatusDetails
        ).toHaveBeenCalledWith(
            'https://provider.example.test',
            'demo',
            'secret'
        );
    });

    it('marks Xtream sources the portal reports as expired', async () => {
        portalStatusService.checkPortalStatusDetails.mockResolvedValue({
            status: 'expired',
            expiresAtSeconds: null,
        });

        await service.refresh([xtreamPlaylist]);

        expect(service.facts().get('xtream-1')).toEqual({
            expiresAtSeconds: null,
            reportedExpired: true,
        });
    });

    it('records no facts for unreachable portals or failed checks', async () => {
        portalStatusService.checkPortalStatusDetails.mockResolvedValueOnce({
            status: 'unavailable',
            expiresAtSeconds: null,
        });
        await service.refresh([xtreamPlaylist]);
        expect(service.facts().has('xtream-1')).toBe(false);

        portalStatusService.checkPortalStatusDetails.mockRejectedValueOnce(
            new Error('offline')
        );
        await service.refresh([xtreamPlaylist]);
        expect(service.facts().has('xtream-1')).toBe(false);
    });

    it('reads Stalker expirations from the stored snapshot and memoizes the read', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                // Stored verbatim at import — a date string despite the
                // declared number type; the normalizer must parse it.
                stalkerAccountInfo: { expireDate: '2027-10-01' },
            })
        );

        await service.refresh([stalkerPlaylist]);

        const facts = service.facts().get('stalker-1');
        expect(facts?.reportedExpired).toBe(false);
        expect(facts?.expiresAtSeconds).toBe(
            Math.round(new Date(2027, 9, 1).getTime() / 1000)
        );

        await service.refresh([stalkerPlaylist]);
        expect(playlistsService.getPlaylistById).toHaveBeenCalledTimes(1);
    });

    it('re-reads the Stalker snapshot after a playlist refresh changes the fingerprint', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                stalkerAccountInfo: { expireDate: '2027-10-01' },
            })
        );

        await service.refresh([stalkerPlaylist]);
        await service.refresh([
            { ...stalkerPlaylist, updateDate: 1_760_000_000_000 },
        ]);

        expect(playlistsService.getPlaylistById).toHaveBeenCalledTimes(2);
    });

    it('records no facts when the snapshot is absent or unlimited', async () => {
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'stalker-1',
                stalkerAccountInfo: { expireDate: '-1' },
            })
        );

        await service.refresh([stalkerPlaylist]);

        expect(service.facts().has('stalker-1')).toBe(false);
    });

    it('does not cache failed Stalker reads', async () => {
        playlistsService.getPlaylistById.mockReturnValueOnce(
            throwError(() => new Error('db down'))
        );
        await service.refresh([stalkerPlaylist]);
        expect(service.facts().has('stalker-1')).toBe(false);

        playlistsService.getPlaylistById.mockReturnValueOnce(
            of({
                _id: 'stalker-1',
                stalkerAccountInfo: { expireDate: '2027-10-01' },
            })
        );
        await service.refresh([stalkerPlaylist]);
        expect(service.facts().has('stalker-1')).toBe(true);
    });

    it('ignores M3U playlists and prunes removed sources', async () => {
        portalStatusService.checkPortalStatusDetails.mockResolvedValue({
            status: 'active',
            expiresAtSeconds: Math.floor(Date.now() / 1000) + DAY_SECONDS,
        });

        await service.refresh([xtreamPlaylist, m3uPlaylist]);
        expect(service.facts().has('xtream-1')).toBe(true);
        expect(service.facts().has('m3u-1')).toBe(false);

        await service.refresh([m3uPlaylist]);
        expect(service.facts().has('xtream-1')).toBe(false);
    });
});
