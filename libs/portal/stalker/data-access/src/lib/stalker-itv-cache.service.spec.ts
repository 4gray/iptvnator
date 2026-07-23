import { TestBed } from '@angular/core/testing';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerItvCacheService } from './stalker-itv-cache.service';
import { StalkerSessionService } from './stalker-session.service';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const PLAYLIST = {
    _id: 'playlist-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-04-14T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    isFullStalkerPortal: false,
} as PlaylistMeta;

type StalkerParams = Record<string, string | number>;

interface RequestHandlers {
    allChannels?: () => Promise<unknown> | unknown;
    page?: (page: number) => Promise<unknown> | unknown;
}

function channel(id: string, name: string, genreId: string) {
    return {
        id,
        name,
        cmd: `ffrt http://stream.example/${id}`,
        tv_genre_id: genreId,
    };
}

function pageOf(items: unknown[], totalItems: number, pageSize = 14) {
    return {
        js: {
            data: items,
            total_items: totalItems,
            max_page_items: pageSize,
        },
    };
}

const UNSUPPORTED_ACTION = { js: { error: 'Unknown action: get_all_channels' } };

async function flushMicrotasks(times = 5): Promise<void> {
    for (let index = 0; index < times; index += 1) {
        await Promise.resolve();
    }
}

describe('StalkerItvCacheService', () => {
    let service: StalkerItvCacheService;
    let sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>;

    function mockRequests(handlers: RequestHandlers): void {
        sendIpcEvent.mockImplementation(
            async (_event: unknown, payload: unknown) => {
                const params = (payload as { params: StalkerParams }).params;
                if (params['action'] === 'get_all_channels') {
                    if (!handlers.allChannels) {
                        throw new Error('unexpected get_all_channels');
                    }
                    return handlers.allChannels();
                }
                if (params['action'] === 'get_ordered_list') {
                    if (!handlers.page) {
                        throw new Error('unexpected get_ordered_list');
                    }
                    return handlers.page(Number(params['p']));
                }
                throw new Error(`unexpected action ${params['action']}`);
            }
        );
    }

    function callsFor(action: string): number {
        return sendIpcEvent.mock.calls.filter(
            (call) =>
                (call[1] as { params: StalkerParams }).params['action'] ===
                action
        ).length;
    }

    beforeEach(() => {
        sendIpcEvent = jest.fn();

        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: { sendIpcEvent } },
                {
                    provide: StalkerSessionService,
                    useValue: { makeAuthenticatedRequest: jest.fn() },
                },
            ],
        });

        service = TestBed.inject(StalkerItvCacheService);
    });

    it('loads the full list via get_all_channels in a single request', async () => {
        mockRequests({
            allChannels: () =>
                pageOf(
                    [
                        channel('1', 'News One', '5'),
                        // stream_id fallback used when id is missing
                        {
                            stream_id: '2',
                            name: 'Sports HD',
                            cmd: 'ffrt http://stream.example/2',
                            tv_genre_id: '9',
                        },
                    ],
                    2
                ),
        });

        await service.ensureLoaded(PLAYLIST);

        expect(service.isReady(PLAYLIST)).toBe(true);
        expect(service.versionFor(PLAYLIST)).toBe(1);
        expect(sendIpcEvent).toHaveBeenCalledTimes(1);

        const channels = service.getChannels(PLAYLIST);
        expect(channels?.map((item) => item.id)).toEqual(['1', '2']);
        expect(channels?.every((item) => typeof item.cmd === 'string')).toBe(
            true
        );
    });

    it('falls back to crawling get_ordered_list pages when get_all_channels is unsupported', async () => {
        mockRequests({
            allChannels: () => UNSUPPORTED_ACTION,
            page: (page) =>
                pageOf(
                    Array.from({ length: page === 2 ? 14 : 14 }, (_, index) =>
                        channel(
                            `${page}-${index}`,
                            `Channel ${page}-${index}`,
                            '5'
                        )
                    ),
                    28
                ),
        });

        await service.ensureLoaded(PLAYLIST);

        expect(service.isReady(PLAYLIST)).toBe(true);
        expect(service.getChannels(PLAYLIST)).toHaveLength(28);
        expect(callsFor('get_all_channels')).toBe(1);
        expect(callsFor('get_ordered_list')).toBe(2);
    });

    it('reports crawl progress while loading and clears it afterwards', async () => {
        let resolveSecondPage!: (value: unknown) => void;
        mockRequests({
            allChannels: () => UNSUPPORTED_ACTION,
            page: (page) => {
                if (page === 1) {
                    return pageOf(
                        Array.from({ length: 14 }, (_, index) =>
                            channel(`1-${index}`, `Channel ${index}`, '5')
                        ),
                        28
                    );
                }
                return new Promise((resolve) => {
                    resolveSecondPage = resolve;
                });
            },
        });

        const load = service.ensureLoaded(PLAYLIST);
        await flushMicrotasks();

        expect(service.isLoading(PLAYLIST)).toBe(true);
        expect(service.progressOf(PLAYLIST)).toEqual({ loaded: 14, total: 28 });

        resolveSecondPage(
            pageOf(
                Array.from({ length: 14 }, (_, index) =>
                    channel(`2-${index}`, `Channel ${index}`, '5')
                ),
                28
            )
        );
        await load;

        expect(service.isLoading(PLAYLIST)).toBe(false);
        expect(service.progressOf(PLAYLIST)).toBeNull();
        expect(service.getChannels(PLAYLIST)).toHaveLength(28);
    });

    it('stops the crawl early when the portal serves an empty page', async () => {
        mockRequests({
            allChannels: () => UNSUPPORTED_ACTION,
            page: (page) =>
                page === 1
                    ? pageOf(
                          Array.from({ length: 14 }, (_, index) =>
                              channel(`1-${index}`, `Channel ${index}`, '5')
                          ),
                          // Portal claims more items than it can serve.
                          280
                      )
                    : pageOf([], 280),
        });

        await service.ensureLoaded(PLAYLIST);

        expect(service.isReady(PLAYLIST)).toBe(true);
        expect(service.getChannels(PLAYLIST)).toHaveLength(14);
    });

    it('memoizes unsupported portals and keeps the legacy flow in charge', async () => {
        mockRequests({
            allChannels: () => UNSUPPORTED_ACTION,
            page: () => pageOf([], 0),
        });

        await service.ensureLoaded(PLAYLIST);
        const callsAfterFirstAttempt = sendIpcEvent.mock.calls.length;

        await service.ensureLoaded(PLAYLIST);

        expect(service.isReady(PLAYLIST)).toBe(false);
        expect(sendIpcEvent.mock.calls.length).toBe(callsAfterFirstAttempt);
    });

    it('throttles retries after a transient failure, then retries once the cooldown elapses', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
        try {
            mockRequests({
                allChannels: () => Promise.reject(new Error('network down')),
                page: () => Promise.reject(new Error('network down')),
            });

            await service.ensureLoaded(PLAYLIST);
            expect(service.isReady(PLAYLIST)).toBe(false);
            const callsAfterError = sendIpcEvent.mock.calls.length;

            // Portal is reachable again, but within the cooldown window the
            // whole portal must NOT be re-crawled (prevents a hammering loop
            // when a page fails deterministically).
            mockRequests({
                allChannels: () => pageOf([channel('1', 'News One', '5')], 1),
            });
            await service.ensureLoaded(PLAYLIST);
            expect(sendIpcEvent.mock.calls.length).toBe(callsAfterError);
            expect(service.isReady(PLAYLIST)).toBe(false);

            // After the cooldown elapses the next visit retries.
            nowSpy.mockReturnValue(1_000_000 + 31_000);
            await service.ensureLoaded(PLAYLIST);
            expect(service.isReady(PLAYLIST)).toBe(true);
            expect(service.getChannels(PLAYLIST)).toHaveLength(1);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('a refresh bypasses the error cooldown', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
        try {
            mockRequests({
                allChannels: () => Promise.reject(new Error('network down')),
                page: () => Promise.reject(new Error('network down')),
            });
            await service.ensureLoaded(PLAYLIST);
            expect(service.isReady(PLAYLIST)).toBe(false);

            mockRequests({
                allChannels: () => pageOf([channel('1', 'News One', '5')], 1),
            });
            // Same instant — cooldown still active — but an explicit refresh
            // (e.g. the refresh button) must retry immediately.
            await service.refresh(PLAYLIST);
            expect(service.isReady(PLAYLIST)).toBe(true);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('deduplicates channels returned across crawl pages (portal ignoring the page param)', async () => {
        const samePage = () =>
            pageOf(
                [
                    channel('1', 'News One', '5'),
                    channel('2', 'Sports HD', '9'),
                ],
                // Portal claims many items but returns the same two regardless
                // of `p`.
                280
            );
        mockRequests({
            allChannels: () => UNSUPPORTED_ACTION,
            page: () => samePage(),
        });

        await service.ensureLoaded(PLAYLIST);

        expect(service.isReady(PLAYLIST)).toBe(true);
        expect(service.getChannels(PLAYLIST)).toHaveLength(2);
    });

    it('deduplicates channels returned by get_all_channels', async () => {
        mockRequests({
            allChannels: () =>
                pageOf(
                    [
                        channel('1', 'News One', '5'),
                        channel('1', 'News One dup', '5'),
                        channel('2', 'Sports HD', '9'),
                    ],
                    3
                ),
        });

        await service.ensureLoaded(PLAYLIST);

        expect(
            service.getChannels(PLAYLIST)?.map((c) => c.id)
        ).toEqual(['1', '2']);
    });

    it('deduplicates concurrent load requests', async () => {
        let resolveAllChannels!: (value: unknown) => void;
        mockRequests({
            allChannels: () =>
                new Promise((resolve) => {
                    resolveAllChannels = resolve;
                }),
        });

        const first = service.ensureLoaded(PLAYLIST);
        const second = service.ensureLoaded(PLAYLIST);
        await flushMicrotasks();

        resolveAllChannels(pageOf([channel('1', 'News One', '5')], 1));
        await Promise.all([first, second]);

        expect(callsFor('get_all_channels')).toBe(1);
        expect(service.isReady(PLAYLIST)).toBe(true);
    });

    it('keeps serving the previous list while a refresh is in flight', async () => {
        mockRequests({
            allChannels: () => pageOf([channel('1', 'News One', '5')], 1),
        });
        await service.ensureLoaded(PLAYLIST);

        let resolveRefresh!: (value: unknown) => void;
        mockRequests({
            allChannels: () =>
                new Promise((resolve) => {
                    resolveRefresh = resolve;
                }),
        });

        const refresh = service.refresh(PLAYLIST);
        await flushMicrotasks();

        expect(service.isReady(PLAYLIST)).toBe(true);
        expect(service.getChannels(PLAYLIST)?.[0]?.name).toBe('News One');

        resolveRefresh(
            pageOf(
                [
                    channel('1', 'News One', '5'),
                    channel('2', 'Fresh Channel', '9'),
                ],
                2
            )
        );
        await refresh;

        expect(service.getChannels(PLAYLIST)).toHaveLength(2);
        expect(service.versionFor(PLAYLIST)).toBe(2);
    });
});
