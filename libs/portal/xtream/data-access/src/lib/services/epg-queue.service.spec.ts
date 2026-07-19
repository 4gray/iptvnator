import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { EpgQueueService } from './epg-queue.service';
import { XtreamApiService } from './xtream-api.service';
import { XtreamXmltvFallbackService } from './xtream-xmltv-fallback.service';
import type { EpgItem } from '@iptvnator/shared/interfaces';

describe('EpgQueueService', () => {
    let service: EpgQueueService;
    let xtreamApi: { getShortEpg: jest.Mock };
    let fallback: {
        getProgramsForChannel: jest.Mock;
        getCurrentProgramsBatch: jest.Mock;
    };
    let settings: { preferUploadedEpgOverXtream: jest.Mock };

    const credentials = {
        serverUrl: 'https://xtream.example.com',
        username: 'user',
        password: 'pass',
    };

    type ServicePrivates = {
        fetchEpg: (
            credentials: typeof credentials,
            streamId: number
        ) => Promise<void>;
        shouldFetch: (streamId: number) => boolean;
        xmltvPreviewByStreamId: Map<number, EpgItem>;
        epgChannelByStreamId: Map<number, string>;
    };

    beforeEach(() => {
        jest.useFakeTimers();

        xtreamApi = { getShortEpg: jest.fn().mockResolvedValue([]) };
        fallback = {
            getProgramsForChannel: jest.fn().mockResolvedValue([]),
            getCurrentProgramsBatch: jest.fn().mockResolvedValue({}),
        };
        settings = { preferUploadedEpgOverXtream: jest.fn(() => false) };

        TestBed.configureTestingModule({
            providers: [
                EpgQueueService,
                { provide: XtreamApiService, useValue: xtreamApi },
                { provide: XtreamXmltvFallbackService, useValue: fallback },
                { provide: SettingsStore, useValue: settings },
            ],
        });

        service = TestBed.inject(EpgQueueService);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function priv(): ServicePrivates {
        return service as unknown as ServicePrivates;
    }

    function seedXmltvPreview(streamId: number, channelId: string): EpgItem {
        const item = makeEpgItem(channelId, `${channelId} now`);
        priv().xmltvPreviewByStreamId.set(streamId, item);
        return item;
    }

    it('caches empty EPG responses and does not immediately refetch them', async () => {
        xtreamApi.getShortEpg.mockResolvedValue([]);

        await priv().fetchEpg(credentials, 101);

        expect(service.getCached(101)).toEqual([]);
        expect(xtreamApi.getShortEpg).toHaveBeenCalledWith(
            credentials,
            101,
            3,
            { suppressErrorLog: true }
        );
        expect(priv().shouldFetch(101)).toBe(false);
    });

    it('applies a cooldown after EPG request failures', async () => {
        xtreamApi.getShortEpg.mockRejectedValue(new Error('EPG failed'));

        await priv().fetchEpg(credentials, 202);

        expect(priv().shouldFetch(202)).toBe(false);

        jest.advanceTimersByTime(60_001);

        expect(priv().shouldFetch(202)).toBe(true);
    });

    it('falls back to pre-fetched XMLTV when Xtream returns empty', async () => {
        xtreamApi.getShortEpg.mockResolvedValue([]);
        const xmltvItem = seedXmltvPreview(303, 'rtl.de');

        await priv().fetchEpg(credentials, 303);

        expect(service.getCached(303)).toEqual([xmltvItem]);
        expect(fallback.getProgramsForChannel).not.toHaveBeenCalled();
    });

    it('does not consult XMLTV when Xtream already returned programs', async () => {
        const apiItems = [makeEpgItem('rtl.de', 'Punkt 12')];
        xtreamApi.getShortEpg.mockResolvedValue(apiItems);
        seedXmltvPreview(404, 'rtl.de');

        await priv().fetchEpg(credentials, 404);

        expect(service.getCached(404)).toEqual(apiItems);
    });

    it('skips XMLTV when Xtream is empty AND no XMLTV preview was prefetched', async () => {
        xtreamApi.getShortEpg.mockResolvedValue([]);

        await priv().fetchEpg(credentials, 505);

        expect(service.getCached(505)).toEqual([]);
        expect(fallback.getCurrentProgramsBatch).not.toHaveBeenCalled();
    });

    it('batch-prefetches XMLTV for entries with epgChannelId on enqueue', async () => {
        fallback.getCurrentProgramsBatch.mockResolvedValue({
            'rtl.de': makeEpgItem('rtl.de', 'Tagesschau'),
            'sat1.de': makeEpgItem('sat1.de', 'Akte'),
        });
        xtreamApi.getShortEpg.mockResolvedValue([]);

        await service.enqueue(
            [
                { streamId: 1, epgChannelId: 'rtl.de' },
                { streamId: 2, epgChannelId: 'sat1.de' },
                { streamId: 3 },
            ],
            new Set([1, 2, 3]),
            credentials
        );

        expect(fallback.getCurrentProgramsBatch).toHaveBeenCalledTimes(1);
        expect(fallback.getCurrentProgramsBatch).toHaveBeenCalledWith([
            'rtl.de',
            'sat1.de',
        ]);
    });

    it('uses XMLTV directly when the user prefers uploaded EPG', async () => {
        fallback.getCurrentProgramsBatch.mockResolvedValue({
            'rtl.de': makeEpgItem('rtl.de', 'Tagesschau (XMLTV)'),
        });
        settings.preferUploadedEpgOverXtream.mockReturnValue(true);

        await service.enqueue(
            [{ streamId: 707, epgChannelId: 'rtl.de' }],
            new Set([707]),
            credentials
        );

        expect(xtreamApi.getShortEpg).not.toHaveBeenCalled();
        const cached = service.getCached(707);
        expect(cached?.[0].title).toBe('Tagesschau (XMLTV)');
    });

    it('only the latest enqueue commits queue state when prefetches overlap', async () => {
        // Defer batch resolutions so we can interleave them.
        let resolveA!: (v: Record<string, EpgItem>) => void;
        let resolveB!: (v: Record<string, EpgItem>) => void;
        fallback.getCurrentProgramsBatch
            .mockImplementationOnce(
                () =>
                    new Promise<Record<string, EpgItem>>((res) => {
                        resolveA = res;
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<Record<string, EpgItem>>((res) => {
                        resolveB = res;
                    })
            );

        // preferUploaded=true makes the commit path call recordSuccess
        // directly when XMLTV has a hit, so a stale older commit would
        // be observable as an unwanted emit.
        settings.preferUploadedEpgOverXtream.mockReturnValue(true);

        const events: number[] = [];
        const sub = service.epgResult$.subscribe(({ streamId }) =>
            events.push(streamId)
        );

        // A: streams 11, 12 — both with epgChannelId so both would emit
        //    via XMLTV-first path if A's commit ran.
        const enqueueA = service.enqueue(
            [
                { streamId: 11, epgChannelId: 'a-only-1' },
                { streamId: 12, epgChannelId: 'a-only-2' },
            ],
            new Set([11, 12]),
            credentials
        );
        // B: streams 21 only.
        const enqueueB = service.enqueue(
            [{ streamId: 21, epgChannelId: 'b-only' }],
            new Set([21]),
            credentials
        );

        // Resolve B first — it's the latest, should commit.
        resolveB({ 'b-only': makeEpgItem('b-only', 'B-current') });
        await enqueueB;

        // Then resolve A — older, should bail without touching state.
        resolveA({
            'a-only-1': makeEpgItem('a-only-1', 'A1-current'),
            'a-only-2': makeEpgItem('a-only-2', 'A2-current'),
        });
        await enqueueA;

        expect(events).toEqual([21]);
        expect(service.getCached(21)?.[0].title).toBe('B-current');
        expect(service.getCached(11)).toBeNull();
        expect(service.getCached(12)).toBeNull();
        expect(priv().xmltvPreviewByStreamId.has(11)).toBe(false);
        expect(priv().xmltvPreviewByStreamId.has(12)).toBe(false);

        sub.unsubscribe();
    });

    it('drops stale queued provider fetches while a newer XMLTV prefetch is pending', async () => {
        let resolveLatestBatch!: (v: Record<string, EpgItem>) => void;
        fallback.getCurrentProgramsBatch.mockImplementationOnce(
            () =>
                new Promise<Record<string, EpgItem>>((resolve) => {
                    resolveLatestBatch = resolve;
                })
        );
        xtreamApi.getShortEpg.mockResolvedValue([]);

        await service.enqueue([1, 2], new Set([1, 2]), credentials);
        expect(xtreamApi.getShortEpg).toHaveBeenCalledWith(
            credentials,
            1,
            3,
            { suppressErrorLog: true }
        );

        const latestEnqueue = service.enqueue(
            [{ streamId: 3, epgChannelId: 'three.epg' }],
            new Set([3]),
            credentials
        );

        jest.advanceTimersByTime(201);
        await Promise.resolve();

        expect(xtreamApi.getShortEpg).not.toHaveBeenCalledWith(
            credentials,
            2,
            3,
            { suppressErrorLog: true }
        );

        resolveLatestBatch({});
        await latestEnqueue;
    });

    it('clones the caller visibleIds Set so external mutation is harmless', async () => {
        const visible = new Set([1, 2, 3]);
        await service.enqueue(
            [{ streamId: 1, epgChannelId: 'a' }],
            visible,
            credentials
        );

        visible.delete(1);
        visible.delete(2);

        // Internal visible set must still contain 1.
        const internal = (
            service as unknown as { visibleSet: Set<number> }
        ).visibleSet;
        expect(internal.has(1)).toBe(true);
        expect(internal.has(2)).toBe(true);
        expect(internal.has(3)).toBe(true);
    });

    it('clears stale XMLTV preview when a re-enqueue removes the channel id', async () => {
        // First enqueue: stream 100 has a hit.
        fallback.getCurrentProgramsBatch.mockResolvedValueOnce({
            'rtl.de': makeEpgItem('rtl.de', 'Tagesschau'),
        });
        xtreamApi.getShortEpg.mockResolvedValue([]);

        await service.enqueue(
            [{ streamId: 100, epgChannelId: 'rtl.de' }],
            new Set([100]),
            credentials
        );
        expect(priv().xmltvPreviewByStreamId.get(100)?.title).toBe('Tagesschau');

        // Second enqueue: same stream 100 but no longer has an epgChannelId.
        // Batch isn't called (no ids to fetch); preview must be cleared.
        fallback.getCurrentProgramsBatch.mockResolvedValueOnce({});
        await service.enqueue(
            [{ streamId: 100, epgChannelId: undefined }],
            new Set([100]),
            credentials
        );

        expect(priv().xmltvPreviewByStreamId.has(100)).toBe(false);
        expect(priv().epgChannelByStreamId.has(100)).toBe(false);
    });

    it('prunes XMLTV preview when its cache entry has expired (TTL-aware)', async () => {
        fallback.getCurrentProgramsBatch.mockResolvedValueOnce({
            'rtl.de': makeEpgItem('rtl.de', 'Tagesschau'),
        });
        xtreamApi.getShortEpg.mockResolvedValue([]);

        // Initial enqueue: stream 100 visible, gets cached.
        await service.enqueue(
            [{ streamId: 100, epgChannelId: 'rtl.de' }],
            new Set([100]),
            credentials
        );
        expect(priv().xmltvPreviewByStreamId.has(100)).toBe(true);

        // Stream 100 leaves the viewport but still has a (live) cache entry,
        // so prune keeps the preview alive — by design.
        await service.enqueue([], new Set([]), credentials);
        expect(priv().xmltvPreviewByStreamId.has(100)).toBe(true);

        // Advance past the 5-minute cache TTL. Now the cache entry is stale;
        // prune must drop the preview rather than cling to an expired hit.
        jest.advanceTimersByTime(5 * 60 * 1000 + 1);
        await service.enqueue([], new Set([]), credentials);

        expect(priv().xmltvPreviewByStreamId.has(100)).toBe(false);
        expect(priv().epgChannelByStreamId.has(100)).toBe(false);
    });

    it('does not re-emit on empty→empty transitions', async () => {
        xtreamApi.getShortEpg.mockResolvedValue([]);
        const events: number[] = [];
        const sub = service.epgResult$.subscribe(({ streamId }) =>
            events.push(streamId)
        );

        await priv().fetchEpg(credentials, 808);
        await priv().fetchEpg(credentials, 808);

        expect(events).toEqual([808]);
        sub.unsubscribe();
    });
});

function makeEpgItem(channelId: string, title: string): EpgItem {
    return {
        id: `${channelId}|x`,
        epg_id: '',
        title,
        lang: '',
        start: '2026-05-07T08:00:00Z',
        end: '2026-05-07T09:00:00Z',
        stop: '2026-05-07T09:00:00Z',
        description: '',
        channel_id: channelId,
        start_timestamp: '0',
        stop_timestamp: '0',
    };
}
