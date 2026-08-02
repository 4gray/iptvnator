import { TestBed } from '@angular/core/testing';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta, STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import {
    normalizeStoredStalkerAccountInfo,
    parseStalkerDate,
    StalkerAccountInfoService,
} from './stalker-account-info.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { StalkerSessionService } from './stalker-session.service';

describe('StalkerAccountInfoService', () => {
    let service: StalkerAccountInfoService;
    let dataService: { sendIpcEvent: jest.Mock };
    let stalkerSession: {
        refreshAccountProfile: jest.Mock;
        makeAuthenticatedRequest: jest.Mock;
    };
    let portalRepair: {
        applyOverride: jest.Mock;
        shouldAttemptRepair: jest.Mock;
        repairPortal: jest.Mock;
    };

    const portalPlaylist = {
        _id: 'stalker-1',
        title: 'Living Room',
        count: 0,
        importDate: '2026-04-05T10:00:00.000Z',
        autoRefresh: false,
        macAddress: '00:1A:79:00:00:01',
        portalUrl: 'http://portal.example/portal.php',
    } as PlaylistMeta;

    const fullPortalPlaylist = {
        ...portalPlaylist,
        _id: 'stalker-2',
        portalUrl: 'http://portal.example/stalker_portal/c/',
        isFullStalkerPortal: true,
    } as PlaylistMeta;

    beforeEach(() => {
        dataService = { sendIpcEvent: jest.fn() };
        stalkerSession = {
            refreshAccountProfile: jest.fn(),
            makeAuthenticatedRequest: jest.fn(),
        };
        portalRepair = {
            applyOverride: jest.fn((playlist) => playlist),
            shouldAttemptRepair: jest.fn().mockReturnValue(false),
            repairPortal: jest.fn().mockResolvedValue(null),
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: dataService },
                { provide: StalkerSessionService, useValue: stalkerSession },
                {
                    provide: StalkerPortalRepairService,
                    useValue: portalRepair,
                },
            ],
        });

        service = TestBed.inject(StalkerAccountInfoService);
    });

    it('returns null for playlists without portal credentials', async () => {
        await expect(
            service.fetchAccountInfo({
                ...portalPlaylist,
                macAddress: undefined,
            } as PlaylistMeta)
        ).resolves.toBeNull();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(stalkerSession.refreshAccountProfile).not.toHaveBeenCalled();
    });

    it('re-authenticates full portals and maps the profile account block', async () => {
        stalkerSession.refreshAccountProfile.mockResolvedValue({
            login: 'user-77',
            expire_date: 1_790_000_000,
            tariff_plan_name: 'Premium',
            status: '1',
        });

        const snapshot = await service.fetchAccountInfo(fullPortalPlaylist);

        // Routed through the session service so the handshake serializes
        // with ensureToken() and the new token replaces the cached one.
        expect(stalkerSession.refreshAccountProfile).toHaveBeenCalledWith(
            expect.objectContaining({ _id: fullPortalPlaylist._id })
        );
        expect(snapshot).toEqual({
            login: 'user-77',
            expireDate: 1_790_000_000,
            tariffPlanName: 'Premium',
            status: 1,
            mac: undefined,
            phone: undefined,
        });
    });

    it('repairs the portal and retries when the profile request hits a repair trigger', async () => {
        // The full-portal profile path bypasses executeStalkerRequest, so
        // opening the dialog on a playlist with a stale endpoint must be
        // able to repair it instead of just failing.
        const notFound = new Error('HTTP Error 404: Not Found');
        stalkerSession.refreshAccountProfile
            .mockRejectedValueOnce(notFound)
            .mockResolvedValueOnce({ login: 'user-1' });
        const repaired = {
            ...fullPortalPlaylist,
            portalUrl: 'http://portal.example/stalker_portal/server/load.php',
        } as PlaylistMeta;
        portalRepair.shouldAttemptRepair.mockReturnValue(true);
        portalRepair.repairPortal.mockResolvedValue(repaired);

        const snapshot = await service.fetchAccountInfo(fullPortalPlaylist);

        expect(portalRepair.repairPortal).toHaveBeenCalledWith(
            fullPortalPlaylist
        );
        expect(
            stalkerSession.refreshAccountProfile
        ).toHaveBeenLastCalledWith(
            expect.objectContaining({ portalUrl: repaired.portalUrl })
        );
        expect(snapshot).toMatchObject({ login: 'user-1' });
    });

    it('re-routes to get_main_info when the repair proves the portal is simple', async () => {
        // The playlist was wrongly marked full; discovery proves it is a
        // token-free panel, so retrying the handshake profile would fail
        // identically — the retry must use the simple-portal path.
        stalkerSession.refreshAccountProfile.mockRejectedValue(
            new Error('HTTP Error 404: Not Found')
        );
        dataService.sendIpcEvent.mockResolvedValue({
            js: { login: 'panel-user' },
        });
        portalRepair.shouldAttemptRepair.mockReturnValue(true);
        portalRepair.repairPortal.mockResolvedValue({
            ...fullPortalPlaylist,
            portalUrl: 'http://portal.example/portal.php',
            isFullStalkerPortal: false,
        } as PlaylistMeta);

        const snapshot = await service.fetchAccountInfo(fullPortalPlaylist);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            STALKER_REQUEST,
            expect.objectContaining({
                params: expect.objectContaining({ action: 'get_main_info' }),
            })
        );
        expect(snapshot).toMatchObject({ login: 'panel-user' });
    });

    it('rethrows profile failures the repair declines to act on', async () => {
        const boom = new Error('timeout of 15000ms exceeded');
        stalkerSession.refreshAccountProfile.mockRejectedValue(boom);

        await expect(
            service.fetchAccountInfo(fullPortalPlaylist)
        ).rejects.toBe(boom);
        expect(portalRepair.repairPortal).not.toHaveBeenCalled();
    });

    it('returns null when the full-portal profile has no account block', async () => {
        stalkerSession.refreshAccountProfile.mockResolvedValue(undefined);

        await expect(
            service.fetchAccountInfo(fullPortalPlaylist)
        ).resolves.toBeNull();
    });

    it('queries get_main_info for portal.php panels and maps varying field names', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                mac: '00:1A:79:00:00:01',
                phone: '10042',
                fname: 'Fallback Name',
                tariff_plan: 'Basic 30',
                end_date: '2026-10-01',
                status: 1,
            },
        });

        const snapshot = await service.fetchAccountInfo(portalPlaylist);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            STALKER_REQUEST,
            expect.objectContaining({
                url: portalPlaylist.portalUrl,
                macAddress: portalPlaylist.macAddress,
                params: expect.objectContaining({
                    type: 'account_info',
                    action: 'get_main_info',
                }),
            })
        );
        expect(snapshot).toEqual({
            login: 'Fallback Name',
            expireDate: Math.round(new Date(2026, 9, 1).getTime() / 1000),
            tariffPlanName: 'Basic 30',
            status: 1,
            mac: '00:1A:79:00:00:01',
            phone: '10042',
        });
    });

    it('unwraps the nested js.account_info envelope used by Ministra-style portals', async () => {
        // Same envelope fetchStalkerExpireDate() consumes in
        // stalker-player-request.utils — nested facts must win over
        // flat aliases.
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                mac: '00:1A:79:00:00:01',
                tariff_plan: 'Flat Alias Plan',
                account_info: {
                    login: 'nested-user',
                    expire_date: 1_790_000_000,
                    tariff_plan_name: 'Nested Premium',
                    status: '1',
                },
            },
        });

        const snapshot = await service.fetchAccountInfo(portalPlaylist);

        expect(snapshot).toEqual({
            login: 'nested-user',
            expireDate: 1_790_000_000,
            tariffPlanName: 'Nested Premium',
            status: 1,
            mac: '00:1A:79:00:00:01',
            phone: undefined,
        });
    });

    it('sends the JsHttpRequest parameter legacy panels expect', async () => {
        dataService.sendIpcEvent.mockResolvedValue({ js: {} });

        await service.fetchAccountInfo(portalPlaylist);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({ JsHttpRequest: '1-xml' }),
            })
        );
    });

    it('treats a stalker_portal URL as a full portal when the flag is absent', async () => {
        // Restored older backups persist `undefined` for the flag after the
        // one-shot metadata migration already ran.
        stalkerSession.refreshAccountProfile.mockResolvedValue({
            login: 'restored-user',
        });

        const snapshot = await service.fetchAccountInfo({
            ...portalPlaylist,
            portalUrl: 'http://portal.example/stalker_portal/c/',
            isFullStalkerPortal: undefined,
        } as PlaylistMeta);

        expect(stalkerSession.refreshAccountProfile).toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(snapshot?.login).toBe('restored-user');
    });

    it('keeps portal.php panels on the legacy path when the flag is absent', async () => {
        dataService.sendIpcEvent.mockResolvedValue({ js: { login: 'legacy' } });

        await service.fetchAccountInfo({
            ...portalPlaylist,
            isFullStalkerPortal: undefined,
        } as PlaylistMeta);

        expect(dataService.sendIpcEvent).toHaveBeenCalled();
        expect(stalkerSession.refreshAccountProfile).not.toHaveBeenCalled();
    });

    it('returns null when get_main_info yields no usable facts', async () => {
        dataService.sendIpcEvent.mockResolvedValue({ js: {} });

        await expect(
            service.fetchAccountInfo(portalPlaylist)
        ).resolves.toBeNull();
    });

    it('propagates portal errors so the dialog can fall back to cached data', async () => {
        dataService.sendIpcEvent.mockRejectedValue(new Error('offline'));

        await expect(
            service.fetchAccountInfo(portalPlaylist)
        ).rejects.toThrow('offline');
    });
});

describe('normalizeStoredStalkerAccountInfo', () => {
    it('parses stringly-typed persisted values from the import path', () => {
        expect(
            normalizeStoredStalkerAccountInfo({
                login: 'user-1',
                expireDate: '2026-10-01' as unknown as number,
                tariffPlanName: 'Premium',
                status: '1' as unknown as number,
            })
        ).toEqual({
            login: 'user-1',
            expireDate: Math.round(new Date(2026, 9, 1).getTime() / 1000),
            tariffPlanName: 'Premium',
            status: 1,
        });
    });

    it('passes through well-formed numeric snapshots unchanged', () => {
        expect(
            normalizeStoredStalkerAccountInfo({
                login: 'user-1',
                expireDate: 1_790_000_000,
                tariffPlanName: 'Premium',
                status: 1,
            })
        ).toEqual({
            login: 'user-1',
            expireDate: 1_790_000_000,
            tariffPlanName: 'Premium',
            status: 1,
        });
    });

    it('returns null for missing or fact-free snapshots', () => {
        expect(normalizeStoredStalkerAccountInfo(undefined)).toBeNull();
        expect(normalizeStoredStalkerAccountInfo(null)).toBeNull();
        expect(normalizeStoredStalkerAccountInfo({})).toBeNull();
        expect(
            normalizeStoredStalkerAccountInfo({
                expireDate: '0000-00-00' as unknown as number,
            })
        ).toBeNull();
    });
});

describe('parseStalkerDate', () => {
    it('accepts unix seconds, unix milliseconds, and date strings', () => {
        expect(parseStalkerDate(1_790_000_000)).toBe(1_790_000_000);
        expect(parseStalkerDate('1790000000')).toBe(1_790_000_000);
        expect(parseStalkerDate(1_790_000_000_000)).toBe(1_790_000_000);
        expect(parseStalkerDate('2026-10-01')).toBe(
            Math.round(new Date(2026, 9, 1).getTime() / 1000)
        );
    });

    it('reads a bare date as a local calendar day, not UTC midnight', () => {
        // Date.parse('2026-10-01') is UTC midnight, which renders as
        // September 30 anywhere west of UTC.
        const parsed = parseStalkerDate('2026-10-01') as number;
        const rendered = new Date(parsed * 1000);

        expect(rendered.getFullYear()).toBe(2026);
        expect(rendered.getMonth()).toBe(9);
        expect(rendered.getDate()).toBe(1);
    });

    it('keeps timestamps that carry a time or offset on standard parsing', () => {
        expect(parseStalkerDate('2026-10-01T12:00:00Z')).toBe(
            Math.round(Date.parse('2026-10-01T12:00:00Z') / 1000)
        );
    });

    it('rejects empty, zero, and placeholder dates', () => {
        expect(parseStalkerDate(undefined)).toBeUndefined();
        expect(parseStalkerDate(null)).toBeUndefined();
        expect(parseStalkerDate('')).toBeUndefined();
        expect(parseStalkerDate(0)).toBeUndefined();
        expect(parseStalkerDate('0000-00-00')).toBeUndefined();
        expect(parseStalkerDate('not a date')).toBeUndefined();
    });

    it('rejects out-of-range calendar components instead of normalizing them', () => {
        // new Date(2026, -1, 0) silently becomes Nov 30, 2025 — a
        // placeholder must not fabricate an expiry.
        expect(parseStalkerDate('2026-00-00')).toBeUndefined();
        expect(parseStalkerDate('2026-02-30')).toBeUndefined();
        expect(parseStalkerDate('2026-13-01')).toBeUndefined();
    });

    it('rejects negative unlimited-expiry sentinels instead of parsing them as dates', () => {
        // V8 reads Date.parse('-1') as January 1, 2001 — an unlimited
        // account must not render as expired.
        expect(parseStalkerDate('-1')).toBeUndefined();
        expect(parseStalkerDate(-1)).toBeUndefined();
        expect(parseStalkerDate('0')).toBeUndefined();
    });
});
