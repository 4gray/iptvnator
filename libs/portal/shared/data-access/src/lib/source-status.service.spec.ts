import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    PortalStatusService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    PlaylistMeta,
    SourceHealthHistoryEntry,
    SourceHealthSnapshot,
} from '@iptvnator/shared/interfaces';
import { sourceHealthFingerprint } from './source-health-identity';
import { SourceHealthHistoryService } from './source-health-history.service';
import { SourceHealthService } from './source-health.service';
import { SourceStatusService } from './source-status.service';

const base = {
    count: 0,
    importDate: '2026-01-01T00:00:00.000Z',
    autoRefresh: false,
};
const m3u: PlaylistMeta = {
    ...base,
    _id: 'm',
    title: 'm',
    url: 'https://m.test/list',
};
const local: PlaylistMeta = { ...base, _id: 'l', title: 'l' };
const xtream: PlaylistMeta = {
    ...base,
    _id: 'x',
    title: 'x',
    serverUrl: 'http://x.test',
    username: 'u',
    password: 'p',
};

describe('SourceStatusService', () => {
    let snapshots: Map<string, SourceHealthSnapshot>;
    let history: ReturnType<
        typeof signal<Map<string, SourceHealthHistoryEntry>>
    >;
    let health: { get: jest.Mock; check: jest.Mock; recheck: jest.Mock };
    let portal: {
        getCachedStatus: jest.Mock;
        checkPortalStatus: jest.Mock;
    };

    const create = (supportsSourceHealth: boolean) => {
        TestBed.configureTestingModule({
            providers: [
                SourceStatusService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsSourceHealth },
                },
                { provide: SourceHealthService, useValue: health },
                {
                    provide: SourceHealthHistoryService,
                    useValue: { entries: history },
                },
                { provide: PortalStatusService, useValue: portal },
            ],
        });
        return TestBed.inject(SourceStatusService);
    };

    beforeEach(() => {
        snapshots = new Map();
        history = signal(new Map());
        health = {
            get: jest.fn((p: PlaylistMeta) => snapshots.get(p._id)),
            check: jest.fn().mockResolvedValue(undefined),
            recheck: jest.fn().mockResolvedValue(undefined),
        };
        portal = {
            getCachedStatus: jest.fn().mockReturnValue(null),
            checkPortalStatus: jest.fn().mockResolvedValue('active'),
        };
    });
    afterEach(() => TestBed.resetTestingModule());

    describe('desktop', () => {
        it('has no status for a local file', () => {
            expect(create(true).statusOf(local)).toBeNull();
        });

        it('reports a live result with the kept failing run', () => {
            snapshots.set('m', {
                state: 'unavailable',
                reason: 'network',
                confirmedInactive: false,
                checkedAt: 900,
            });
            history.set(
                new Map([
                    ['m', { state: 'bad', checkedAt: 900, failingSince: 100 }],
                ])
            );
            expect(create(true).statusOf(m3u)).toEqual({
                reachability: 'bad',
                failingSince: 100,
                checkedAt: 900,
                reason: 'network',
            });
        });

        it('ignores a result kept for the source before its address changed', () => {
            history.set(
                new Map([
                    [
                        'm',
                        {
                            state: 'bad',
                            checkedAt: 50,
                            failingSince: 10,
                            connection: 'another-address',
                        },
                    ],
                ])
            );
            const service = create(true);
            expect(service.statusOf(m3u)).toEqual({
                reachability: 'unknown',
            });

            history.set(
                new Map([
                    [
                        'm',
                        {
                            state: 'bad',
                            checkedAt: 50,
                            connection: sourceHealthFingerprint(m3u),
                        },
                    ],
                ])
            );
            expect(service.statusOf(m3u)?.reachability).toBe('bad');
        });

        it("keeps a failed check's cause across a restart", () => {
            history.set(
                new Map([
                    [
                        'm',
                        {
                            state: 'bad',
                            checkedAt: 50,
                            failingSince: 10,
                            reason: 'auth',
                        },
                    ],
                ])
            );
            expect(create(true).statusOf(m3u)?.reason).toBe('auth');
        });

        it('shows the kept result before and while the source is checked', () => {
            history.set(
                new Map([
                    ['m', { state: 'bad', checkedAt: 50, failingSince: 10 }],
                ])
            );
            const service = create(true);
            expect(service.statusOf(m3u)).toEqual({
                reachability: 'bad',
                failingSince: 10,
                checkedAt: 50,
                pending: false,
            });
            snapshots.set('m', {
                state: 'checking',
                reason: 'unknown',
                confirmedInactive: false,
                checkedAt: 0,
            });
            expect(service.statusOf(m3u)?.pending).toBe(true);
        });

        it('says why an inconclusive check is inconclusive', () => {
            snapshots.set('m', {
                state: 'unavailable',
                reason: 'paused',
                confirmedInactive: false,
                checkedAt: 700,
            });
            expect(create(true).statusOf(m3u)).toEqual({
                reachability: 'unknown',
                reason: 'paused',
                checkedAt: 700,
            });
        });

        it('reports an unchecked source as unknown', () => {
            expect(create(true).statusOf(m3u)).toEqual({
                reachability: 'unknown',
            });
        });

        it('delegates checks to the health service', () => {
            const service = create(true);
            const controller = new AbortController();
            service.ensureChecked(m3u, controller.signal);
            service.ensureChecked(local, controller.signal);
            service.recheck(m3u);
            expect(health.check).toHaveBeenCalledTimes(1);
            expect(health.check).toHaveBeenCalledWith(m3u, {
                signal: controller.signal,
            });
            expect(health.recheck).toHaveBeenCalledWith(m3u);
        });
    });

    describe('browser build', () => {
        it('tracks only Xtream accounts', () => {
            const service = create(false);
            expect(service.statusOf(m3u)).toBeNull();
            expect(service.statusOf(xtream)).toEqual({
                reachability: 'unknown',
            });
        });

        it('shows checking, then the portal status', async () => {
            let resolve!: (status: string) => void;
            portal.checkPortalStatus.mockReturnValue(
                new Promise((r) => (resolve = r))
            );
            const service = create(false);
            service.ensureChecked(xtream, new AbortController().signal);
            expect(service.statusOf(xtream)?.reachability).toBe('checking');
            resolve('expired');
            await Promise.resolve();
            await Promise.resolve();
            expect(service.statusOf(xtream)?.reachability).toBe('expired');
        });

        it('serves a cached portal status without a request', () => {
            portal.getCachedStatus.mockReturnValue('inactive');
            const service = create(false);
            service.ensureChecked(xtream, new AbortController().signal);
            expect(portal.checkPortalStatus).not.toHaveBeenCalled();
            expect(service.statusOf(xtream)).toEqual({
                reachability: 'bad',
                reason: 'disabled',
            });
        });

        it("keeps an edited account's status from the old account's slow check", async () => {
            let finishOld!: (status: string) => void;
            portal.checkPortalStatus
                .mockReturnValueOnce(new Promise((r) => (finishOld = r)))
                .mockResolvedValueOnce('active');
            const service = create(false);
            service.recheck(xtream);

            const edited = { ...xtream, password: 'changed' } as PlaylistMeta;
            service.ensureChecked(edited, new AbortController().signal);
            await Promise.resolve();
            await Promise.resolve();
            expect(service.statusOf(edited)?.reachability).toBe('ok');

            finishOld('inactive');
            await Promise.resolve();
            await Promise.resolve();
            expect(service.statusOf(edited)?.reachability).toBe('ok');
        });

        it('drops a result that lands after the list closed', async () => {
            const service = create(false);
            const controller = new AbortController();
            service.ensureChecked(xtream, controller.signal);
            controller.abort();
            await Promise.resolve();
            await Promise.resolve();
            expect(service.statusOf(xtream)?.reachability).toBe('unknown');
        });

        it('bypasses the cache on recheck', () => {
            create(false).recheck(xtream);
            expect(portal.checkPortalStatus).toHaveBeenCalledWith(
                'http://x.test',
                'u',
                'p',
                { skipCache: true }
            );
        });
    });
});
