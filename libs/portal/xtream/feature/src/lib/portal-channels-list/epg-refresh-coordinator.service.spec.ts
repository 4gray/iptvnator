import { TestBed } from '@angular/core/testing';
import { EpgQueueService } from '@iptvnator/portal/xtream/data-access';
import {
    EPG_REFRESH_INTERVAL_MS,
    EpgRefreshContribution,
    EpgRefreshCoordinator,
} from './epg-refresh-coordinator.service';

const credentials = {
    serverUrl: 'http://demo.example',
    username: 'demo',
    password: 'secret',
};

function contribution(
    overrides: Partial<EpgRefreshContribution> = {}
): EpgRefreshContribution {
    return {
        playlistId: 'playlist-1',
        credentials,
        visibleStreamIds: [1],
        staleEntries: [{ streamId: 1 }],
        ...overrides,
    };
}

describe('EpgRefreshCoordinator', () => {
    const epgQueueService = {
        enqueue: jest.fn().mockResolvedValue(undefined),
    };
    let coordinator: EpgRefreshCoordinator;

    beforeEach(() => {
        jest.useFakeTimers();
        epgQueueService.enqueue.mockClear();
        TestBed.configureTestingModule({
            providers: [
                { provide: EpgQueueService, useValue: epgQueueService },
            ],
        });
        coordinator = TestBed.inject(EpgRefreshCoordinator);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('merges what every mounted list needs into one request', () => {
        // Separate requests would cancel one another: the queue is latest-wins
        // and replaces its visible set and pending queue on every call.
        coordinator.register(() =>
            contribution({
                visibleStreamIds: [1, 2],
                staleEntries: [{ streamId: 1 }],
            })
        );
        coordinator.register(() =>
            contribution({
                visibleStreamIds: [3, 4],
                staleEntries: [{ streamId: 3 }],
            })
        );

        jest.advanceTimersByTime(EPG_REFRESH_INTERVAL_MS);

        expect(epgQueueService.enqueue).toHaveBeenCalledTimes(1);
        const [entries, visibleIds] = epgQueueService.enqueue.mock.calls[0];
        expect(entries.map((entry: { streamId: number }) => entry.streamId)) //
            .toEqual([1, 3]);
        // The whole of both slices, so neither list's rows are dropped while
        // the queue works through them.
        expect([...(visibleIds as Set<number>)].sort()).toEqual([1, 2, 3, 4]);
    });

    it('fetches a channel both lists show only once', () => {
        coordinator.register(() => contribution());
        coordinator.register(() => contribution());

        jest.advanceTimersByTime(EPG_REFRESH_INTERVAL_MS);

        const [entries] = epgQueueService.enqueue.mock.calls[0];
        expect(entries).toHaveLength(1);
    });

    it('keeps playlists apart, since their credentials differ', () => {
        coordinator.register(() => contribution({ playlistId: 'playlist-1' }));
        coordinator.register(() =>
            contribution({
                playlistId: 'playlist-2',
                staleEntries: [{ streamId: 9 }],
            })
        );

        jest.advanceTimersByTime(EPG_REFRESH_INTERVAL_MS);

        expect(epgQueueService.enqueue).toHaveBeenCalledTimes(2);
    });

    it('asks for nothing when no list needs anything', () => {
        coordinator.register(() => null);
        coordinator.register(() => contribution({ staleEntries: [] }));

        jest.advanceTimersByTime(EPG_REFRESH_INTERVAL_MS);

        expect(epgQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('stops ticking once the last list has left', () => {
        const leaveFirst = coordinator.register(() => contribution());
        const leaveSecond = coordinator.register(() => contribution());

        leaveFirst();
        jest.advanceTimersByTime(EPG_REFRESH_INTERVAL_MS);
        expect(epgQueueService.enqueue).toHaveBeenCalledTimes(1);

        leaveSecond();
        jest.advanceTimersByTime(5 * EPG_REFRESH_INTERVAL_MS);
        expect(epgQueueService.enqueue).toHaveBeenCalledTimes(1);
    });

    it('survives a rejected enqueue', async () => {
        epgQueueService.enqueue.mockRejectedValueOnce(new Error('offline'));
        coordinator.register(() => contribution());

        jest.advanceTimersByTime(EPG_REFRESH_INTERVAL_MS);
        await Promise.resolve();

        epgQueueService.enqueue.mockResolvedValue(undefined);
        jest.advanceTimersByTime(EPG_REFRESH_INTERVAL_MS);
        expect(epgQueueService.enqueue).toHaveBeenCalledTimes(2);
    });
});
