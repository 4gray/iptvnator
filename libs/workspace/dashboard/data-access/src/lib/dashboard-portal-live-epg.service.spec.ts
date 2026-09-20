import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EpgSourceSettingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { StreamResolverService } from '@iptvnator/portal/shared/data-access';
import {
    DASHBOARD_PORTAL_LIVE_EPG_TIMING,
    DashboardPortalLiveEpgService,
} from './dashboard-portal-live-epg.service';
import type { DashboardPortalLiveEpgEntry } from './dashboard-portal-live-epg.util';

interface Deferred {
    readonly key: string;
    resolve: (program: EpgProgram | null) => void;
    reject: (error: unknown) => void;
}

const entry = (id: number): DashboardPortalLiveEpgEntry => ({
    key: `xtream::p::${id}`,
    item: {
        uid: `xtream::p::${id}`,
        name: `Channel ${id}`,
        contentType: 'live',
        sourceType: 'xtream',
        playlistId: 'p',
        playlistName: 'Portal',
        xtreamId: id,
        tvgId: String(id),
    },
});

const program = (title: string, stopIso?: string): EpgProgram =>
    ({
        channel: 'x',
        title,
        start: '2026-05-23T10:00:00.000Z',
        stop: stopIso ?? '2026-05-23T11:00:00.000Z',
    }) as EpgProgram;

describe('DashboardPortalLiveEpgService', () => {
    let service: DashboardPortalLiveEpgService;
    let loadEpgForItems: jest.Mock;
    let deferred: Deferred[];
    let offsetMinutes: number;
    let sourceChanged: Subject<void>;
    let sourceRevision: number;
    let supportsEpgProgramLookup: boolean;

    const { delayMs, ttlMs, emptyTtlMs, endedRefetchFloorMs } =
        DASHBOARD_PORTAL_LIVE_EPG_TIMING;

    /** What a reconciliation does: bump the fence, then announce it. */
    const changeEpgSources = () => {
        sourceRevision++;
        sourceChanged.next();
    };

    /** Let the queue loop take its next step (one inter-request delay). */
    const step = async (rounds = 1): Promise<void> => {
        for (let i = 0; i < rounds; i++) {
            await jest.advanceTimersByTimeAsync(delayMs);
        }
    };

    /** Settle the LATEST request for `key` — a key can be asked more than once. */
    const settle = async (key: string, value: EpgProgram | null) => {
        const request = [...deferred]
            .reverse()
            .find((request) => request.key === key);
        if (!request) throw new Error(`no request in flight for ${key}`);
        request.resolve(value);
        await jest.advanceTimersByTimeAsync(0);
    };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-23T10:30:00.000Z'));
        deferred = [];
        offsetMinutes = 0;
        sourceRevision = 0;
        supportsEpgProgramLookup = true;
        sourceChanged = new Subject<void>();
        loadEpgForItems = jest.fn((items: { tvgId?: string }[]) => {
            const key = `xtream::p::${items[0].tvgId}`;
            return new Promise<Map<string, EpgProgram | null>>(
                (resolve, reject) => {
                    deferred.push({
                        key,
                        resolve: (value) =>
                            resolve(new Map([[String(items[0].tvgId), value]])),
                        reject,
                    });
                }
            );
        });

        TestBed.configureTestingModule({
            providers: [
                DashboardPortalLiveEpgService,
                {
                    provide: StreamResolverService,
                    useValue: { loadEpgForItems },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        resolvedEpgOffsetMinutes: () => offsetMinutes,
                    },
                },
                {
                    provide: EpgSourceSettingsService,
                    useValue: {
                        changed$: sourceChanged,
                        revision: () => sourceRevision,
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpgProgramLookup() {
                            return supportsEpgProgramLookup;
                        },
                    },
                },
            ],
        });
        service = TestBed.inject(DashboardPortalLiveEpgService);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('answers each card as its own request lands, never waiting for the slowest', async () => {
        service.sync([entry(1), entry(2)]);
        expect(service.pending()).toEqual(
            new Set(['xtream::p::1', 'xtream::p::2'])
        );
        await step(2);
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);

        await settle('xtream::p::2', program('Fast answer'));
        expect(service.programs().get('xtream::p::2')?.title).toBe(
            'Fast answer'
        );
        expect(service.programs().has('xtream::p::1')).toBe(false);
        expect(service.pending()).toEqual(new Set(['xtream::p::1']));

        await settle('xtream::p::1', null);
        expect(service.programs().get('xtream::p::1')).toBeNull();
        expect(service.pending().size).toBe(0);
    });

    it('never has more than two requests in flight and spaces starts by the delay', async () => {
        service.sync([entry(1), entry(2), entry(3), entry(4)]);
        expect(loadEpgForItems).toHaveBeenCalledTimes(1);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);
        await step(3);
        // Two in flight: the loop keeps waiting instead of starting a third.
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);

        await settle('xtream::p::1', null);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(3);
    });

    it('drops a queued card that scrolled away before its turn and keeps the rest', async () => {
        service.sync([entry(1), entry(2), entry(3)]);
        // 1 started; 2 and 3 still queued.
        service.sync([entry(1), entry(3)]);
        expect(service.pending()).toEqual(
            new Set(['xtream::p::1', 'xtream::p::3'])
        );
        await step(2);
        const requested = loadEpgForItems.mock.calls.map(
            ([items]) => items[0].tvgId
        );
        expect(requested).toEqual(['1', '3']);
    });

    it('serves a fresh answer from cache and asks again once the TTL has passed', async () => {
        service.sync([entry(1)]);
        await settle('xtream::p::1', program('Cached'));
        await step();

        service.sync([entry(1)]);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(1);

        jest.setSystemTime(Date.now() + ttlMs);
        service.sync([entry(1)]);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);
    });

    it('asks again when the programme on air has ended, but not more often than the floor', async () => {
        service.sync([entry(1)]);
        await settle(
            'xtream::p::1',
            program('Ending soon', '2026-05-23T10:35:00.000Z')
        );
        await step();

        // Ended 5 min in, but the floor (30 s) already passed → refetch.
        jest.setSystemTime(Date.now() + 6 * 60_000);
        service.sync([entry(1)]);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);

        // Portal keeps returning the ended row: not re-asked within the floor.
        await settle(
            'xtream::p::1',
            program('Still ended', '2026-05-23T10:35:00.000Z')
        );
        await step();
        jest.setSystemTime(Date.now() + endedRefetchFloorMs / 2);
        service.sync([entry(1)]);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);
    });

    it('expires an answer with no programme sooner than one with a programme', async () => {
        // The resolver reports a failed portal and a guide-less channel the
        // same way, so the short TTL is what lets an outage recover.
        service.sync([entry(1)]);
        await settle('xtream::p::1', null);
        await step();
        expect(service.programs().get('xtream::p::1')).toBeNull();

        jest.setSystemTime(Date.now() + emptyTtlMs / 2);
        service.sync([entry(1)]);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(1);

        jest.setSystemTime(Date.now() + emptyTtlMs / 2);
        service.sync([entry(1)]);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);

        // A programme keeps the full TTL, which outlives the empty one.
        await settle('xtream::p::1', program('On air'));
        await step();
        jest.setSystemTime(Date.now() + emptyTtlMs);
        service.sync([entry(1)]);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);
    });

    it('treats a rejected resolver call as an answer with no programme', async () => {
        service.sync([entry(1)]);
        deferred[0].reject(new Error('portal down'));
        await jest.advanceTimersByTimeAsync(0);

        expect(service.programs().get('xtream::p::1')).toBeNull();
        expect(service.pending().size).toBe(0);

        jest.setSystemTime(Date.now() + emptyTtlMs);
        service.sync([entry(1)]);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);
    });

    it('retires an answer evaluated under a previous display offset and asks again', async () => {
        service.sync([entry(1)]);
        offsetMinutes = 60;
        await settle('xtream::p::1', program('Old clock'));
        await step();
        expect(service.programs().has('xtream::p::1')).toBe(false);
        // Still wanted → requeued under the new clock.
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);

        await settle('xtream::p::1', program('New clock'));
        expect(service.programs().get('xtream::p::1')?.title).toBe('New clock');
    });

    it('drops every answer when the EPG sources change and asks the wanted cards again', async () => {
        service.sync([entry(1)]);
        await settle('xtream::p::1', program('Before import'));
        await step();

        changeEpgSources();
        expect(service.programs().size).toBe(0);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);
    });

    it('discards an answer computed before an EPG source change and asks again', async () => {
        // The key is in flight when the sources change, so the retire pass
        // cannot requeue it; the completion must not publish the old guide's
        // answer and must ask again itself.
        service.sync([entry(1)]);
        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(1);

        changeEpgSources();
        await settle('xtream::p::1', program('Removed guide'));
        expect(service.programs().has('xtream::p::1')).toBe(false);

        await step();
        expect(loadEpgForItems).toHaveBeenCalledTimes(2);
        await settle('xtream::p::1', program('Current guide'));
        expect(service.programs().get('xtream::p::1')?.title).toBe(
            'Current guide'
        );
    });

    it('does nothing at all without the local EPG program-lookup capability', async () => {
        // PWA: the collection resolver is gated on the desktop XMLTV bridge
        // and answers nothing, so no request is worth queuing.
        supportsEpgProgramLookup = false;

        service.sync([entry(1), entry(2)]);
        await step(3);

        expect(loadEpgForItems).not.toHaveBeenCalled();
        expect(service.pending().size).toBe(0);
        expect(service.programs().size).toBe(0);
    });
});
