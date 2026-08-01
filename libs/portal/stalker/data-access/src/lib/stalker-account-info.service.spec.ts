import { TestBed } from '@angular/core/testing';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta, STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import {
    normalizeStoredStalkerAccountInfo,
    parseStalkerDate,
    StalkerAccountInfoService,
} from './stalker-account-info.service';
import { StalkerSessionService } from './stalker-session.service';

describe('StalkerAccountInfoService', () => {
    let service: StalkerAccountInfoService;
    let dataService: { sendIpcEvent: jest.Mock };
    let stalkerSession: {
        authenticate: jest.Mock;
        makeAuthenticatedRequest: jest.Mock;
        setCachedToken: jest.Mock;
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
            authenticate: jest.fn(),
            makeAuthenticatedRequest: jest.fn(),
            setCachedToken: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: dataService },
                { provide: StalkerSessionService, useValue: stalkerSession },
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
        expect(stalkerSession.authenticate).not.toHaveBeenCalled();
    });

    it('re-authenticates full portals and maps the profile account block', async () => {
        stalkerSession.authenticate.mockResolvedValue({
            token: 'token-1',
            accountInfo: {
                login: 'user-77',
                expire_date: 1_790_000_000,
                tariff_plan_name: 'Premium',
                status: '1',
            },
        });

        const snapshot = await service.fetchAccountInfo(fullPortalPlaylist);

        expect(stalkerSession.authenticate).toHaveBeenCalledWith(
            fullPortalPlaylist.portalUrl,
            fullPortalPlaylist.macAddress,
            expect.any(Object)
        );
        // The fresh token must land in the managed session cache — strict
        // portals invalidate the previous token on each handshake.
        expect(stalkerSession.setCachedToken).toHaveBeenCalledWith(
            fullPortalPlaylist._id,
            'token-1'
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

    it('returns null when the full-portal profile has no account block', async () => {
        stalkerSession.authenticate.mockResolvedValue({ token: 'token-1' });

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
            expireDate: Math.round(Date.parse('2026-10-01') / 1000),
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
            expireDate: Math.round(Date.parse('2026-10-01') / 1000),
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
            Math.round(Date.parse('2026-10-01') / 1000)
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
});
