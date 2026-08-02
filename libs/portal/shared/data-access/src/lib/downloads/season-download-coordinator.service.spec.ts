import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    DownloadsService,
    type DownloadItem,
    type DownloadStartInput,
} from '@iptvnator/services';
import type {
    ElectronBridgeDownloadStartResult,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import type { EpisodeDownloadIdentity } from '@iptvnator/portal/shared/util';
import type {
    EpisodeDownloadCandidate,
    SeasonEpisodeDownloadAdapter,
} from './season-download.models';
import { SeasonDownloadCoordinator } from './season-download-coordinator.service';

interface DownloadsServiceStub {
    readonly downloads: WritableSignal<DownloadItem[]>;
    readonly hasLoadedDownloads: WritableSignal<boolean>;
    readonly isAvailable: WritableSignal<boolean>;
    readonly startDownload: jest.MockedFunction<
        DownloadsService['startDownload']
    >;
    readonly loadDownloads: jest.MockedFunction<
        DownloadsService['loadDownloads']
    >;
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (reason?: unknown) => void;
}

const FIRST_IDENTITY: EpisodeDownloadIdentity = {
    playlistId: 'playlist-1',
    contentType: 'episode',
    xtreamId: 101,
    seriesXtreamId: 20,
    seasonNumber: 1,
    episodeNumber: 1,
};

describe('SeasonDownloadCoordinator', () => {
    let downloadsService: DownloadsServiceStub;
    let coordinator: SeasonDownloadCoordinator;

    beforeEach(() => {
        downloadsService = {
            downloads: signal<DownloadItem[]>([]),
            hasLoadedDownloads: signal(true),
            isAvailable: signal(true),
            startDownload: jest.fn().mockResolvedValue({ success: true }),
            loadDownloads: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                SeasonDownloadCoordinator,
                { provide: DownloadsService, useValue: downloadsService },
            ],
        });
        coordinator = TestBed.inject(SeasonDownloadCoordinator);
    });

    it('reserves one identity synchronously without blocking a distinct episode', async () => {
        const firstPrepare = deferred<DownloadStartInput>();
        const first = candidate(FIRST_IDENTITY, () => firstPrepare.promise);
        const second = candidate(identity(102, 2));

        const submission = coordinator.enqueueOne(first);

        expect(coordinator.isPending(first.identity)).toBe(true);
        expect(coordinator.isEligible(first)).toBe(false);
        expect(coordinator.isPending(second.identity)).toBe(false);
        expect(coordinator.isEligible(second)).toBe(true);

        firstPrepare.resolve(request(first.identity));
        await expect(submission).resolves.toBe('added');
    });

    it('starts only one download for two rapid submissions of the same identity', async () => {
        const prepare = deferred<DownloadStartInput>();
        const first = candidate(FIRST_IDENTITY, () => prepare.promise);
        const duplicate = candidate(FIRST_IDENTITY);

        const firstSubmission = coordinator.enqueueOne(first);
        const secondSubmission = coordinator.enqueueOne(duplicate);

        await expect(secondSubmission).resolves.toBe('skipped');
        expect(duplicate.prepare).not.toHaveBeenCalled();

        prepare.resolve(request(first.identity));
        await expect(firstSubmission).resolves.toBe('added');
        expect(downloadsService.startDownload).toHaveBeenCalledTimes(1);
    });

    it('submits a season sequentially in display order', async () => {
        const firstStart = deferred<ElectronBridgeDownloadStartResult>();
        const first = candidate(FIRST_IDENTITY);
        const second = candidate(identity(102, 2));
        const adapter = adapterFor([first, second]);
        downloadsService.startDownload
            .mockImplementationOnce(() => firstStart.promise)
            .mockResolvedValueOnce({ success: true });

        const submission = coordinator.enqueueSeason(
            [episode(101, 1), episode(102, 2)],
            adapter,
            '1'
        );
        await flushMicrotasks();

        expect(first.prepare).toHaveBeenCalledTimes(1);
        expect(second.prepare).not.toHaveBeenCalled();
        expect(downloadsService.startDownload).toHaveBeenCalledTimes(1);

        firstStart.resolve({ success: true });
        await flushMicrotasks();

        expect(second.prepare).toHaveBeenCalledTimes(1);
        expect(downloadsService.startDownload).toHaveBeenNthCalledWith(
            2,
            request(second.identity)
        );
        await expect(submission).resolves.toEqual({
            added: 2,
            skipped: 0,
            failed: 0,
        });
    });

    it('partitions invalid, duplicate, blocked, stable skip, and unsuccessful submissions', async () => {
        const stable = candidate(FIRST_IDENTITY);
        const duplicate = candidate(FIRST_IDENTITY);
        const unsuccessful = candidate(identity(102, 2));
        const paused = candidate(identity(103, 3));
        downloadsService.downloads.set([
            download(paused.identity, { status: 'paused' }),
        ]);
        downloadsService.startDownload
            .mockResolvedValueOnce({
                success: false,
                reason: 'already-in-progress',
            })
            .mockResolvedValueOnce({
                success: false,
                error: 'Backend declined the request',
            });
        const adapter = adapterFor([
            null,
            stable,
            duplicate,
            unsuccessful,
            paused,
        ]);

        await expect(
            coordinator.enqueueSeason(
                [
                    episode(100, 0),
                    episode(101, 1),
                    episode(101, 1),
                    episode(102, 2),
                    episode(103, 3),
                ],
                adapter,
                '1'
            )
        ).resolves.toEqual({ added: 0, skipped: 4, failed: 1 });

        expect(stable.prepare).toHaveBeenCalledTimes(1);
        expect(duplicate.prepare).not.toHaveBeenCalled();
        expect(unsuccessful.prepare).toHaveBeenCalledTimes(1);
        expect(paused.prepare).not.toHaveBeenCalled();
        expect(downloadsService.loadDownloads).not.toHaveBeenCalled();
    });

    it('continues after preparation rejects and refreshes once after successes', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
            /* captured */
        });
        const rejected = candidate(FIRST_IDENTITY, () =>
            Promise.reject(
                new Error(
                    'Request failed: https://portal.invalid?username=alice&password=hunter2'
                )
            )
        );
        const ipcFailure = candidate(identity(102, 2));
        const firstSuccess = candidate(identity(103, 3));
        const secondSuccess = candidate(identity(104, 4));
        downloadsService.startDownload.mockRejectedValueOnce(
            new Error(
                'IPC failed: https://portal.invalid?username=alice&password=hunter2'
            )
        );

        try {
            await expect(
                coordinator.enqueueSeason(
                    [
                        episode(101, 1),
                        episode(102, 2),
                        episode(103, 3),
                        episode(104, 4),
                    ],
                    adapterFor([
                        rejected,
                        ipcFailure,
                        firstSuccess,
                        secondSuccess,
                    ])
                )
            ).resolves.toEqual({ added: 2, skipped: 0, failed: 2 });

            expect(downloadsService.startDownload).toHaveBeenCalledTimes(3);
            expect(downloadsService.loadDownloads).toHaveBeenCalledTimes(1);
            expect(warnSpy).toHaveBeenCalled();
            expect(loggedText(warnSpy)).not.toContain('hunter2');
            expect(loggedText(warnSpy)).not.toContain('alice');
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('blocks eligibility and reservation until downloads have loaded', async () => {
        downloadsService.hasLoadedDownloads.set(false);
        const item = candidate(FIRST_IDENTITY);

        expect(coordinator.isEligible(item)).toBe(false);
        await expect(coordinator.enqueueOne(item)).resolves.toBe('skipped');
        expect(item.prepare).not.toHaveBeenCalled();

        downloadsService.hasLoadedDownloads.set(true);
        downloadsService.isAvailable.set(false);
        expect(coordinator.isEligible(item)).toBe(false);
        await expect(coordinator.enqueueOne(item)).resolves.toBe('skipped');
    });

    it('allows a completed missing episode and skips a completed available one', async () => {
        const missing = candidate(FIRST_IDENTITY);
        const available = candidate(identity(102, 2));
        downloadsService.downloads.set([
            download(missing.identity, {
                status: 'completed',
                fileAvailability: 'missing',
            }),
            download(available.identity, {
                status: 'completed',
                fileAvailability: 'available',
            }),
        ]);

        expect(coordinator.findDownload(missing.identity)?.fileAvailability).toBe(
            'missing'
        );
        expect(coordinator.isEligible(missing)).toBe(true);
        expect(coordinator.isEligible(available)).toBe(false);
        await expect(coordinator.enqueueOne(available)).resolves.toBe(
            'skipped'
        );
        expect(available.prepare).not.toHaveBeenCalled();
    });

    it('prepares a duplicate identity only once within one batch', async () => {
        const first = candidate(FIRST_IDENTITY);
        const duplicate = candidate(FIRST_IDENTITY);

        await expect(
            coordinator.enqueueSeason(
                [episode(101, 1), episode(101, 1)],
                adapterFor([first, duplicate])
            )
        ).resolves.toEqual({ added: 1, skipped: 1, failed: 0 });

        expect(first.prepare).toHaveBeenCalledTimes(1);
        expect(duplicate.prepare).not.toHaveBeenCalled();
        expect(downloadsService.startDownload).toHaveBeenCalledTimes(1);
    });

    it('keeps successful keys pending and releases them when refresh rejects', async () => {
        const refresh = deferred<void>();
        const refreshStarted = deferred<void>();
        const first = candidate(FIRST_IDENTITY);
        const second = candidate(identity(102, 2));
        downloadsService.loadDownloads.mockImplementation(() => {
            refreshStarted.resolve(undefined);
            return refresh.promise;
        });

        const submission = coordinator.enqueueSeason(
            [episode(101, 1), episode(102, 2)],
            adapterFor([first, second])
        );
        await refreshStarted.promise;

        expect(coordinator.isPending(first.identity)).toBe(true);
        expect(coordinator.isPending(second.identity)).toBe(true);

        refresh.reject(new Error('Refresh failed'));
        await expect(submission).rejects.toThrow('Refresh failed');
        expect(coordinator.isPending(first.identity)).toBe(false);
        expect(coordinator.isPending(second.identity)).toBe(false);
    });
});

function identity(
    xtreamId: number,
    episodeNumber: number
): EpisodeDownloadIdentity {
    return { ...FIRST_IDENTITY, xtreamId, episodeNumber };
}

function request(value: EpisodeDownloadIdentity): DownloadStartInput {
    return {
        playlistId: value.playlistId,
        xtreamId: value.xtreamId,
        contentType: value.contentType,
        title: `Episode ${value.episodeNumber}`,
        url: `https://stream.invalid/${value.xtreamId}`,
        seriesXtreamId: value.seriesXtreamId,
        seasonNumber: value.seasonNumber,
        episodeNumber: value.episodeNumber,
    };
}

function candidate(
    value: EpisodeDownloadIdentity,
    prepare: () => Promise<DownloadStartInput> = () =>
        Promise.resolve(request(value))
): EpisodeDownloadCandidate & { readonly prepare: jest.Mock } {
    return { identity: value, prepare: jest.fn(prepare) };
}

function episode(
    xtreamId: number,
    episodeNumber: number
): XtreamSerieEpisode {
    return {
        id: String(xtreamId),
        episode_num: episodeNumber,
        title: `Episode ${episodeNumber}`,
        container_extension: 'mp4',
        info: [],
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
    };
}

function adapterFor(
    candidates: readonly (EpisodeDownloadCandidate | null)[]
): SeasonEpisodeDownloadAdapter {
    let index = 0;
    return {
        createCandidate: jest.fn(() => candidates[index++] ?? null),
    };
}

function download(
    value: EpisodeDownloadIdentity,
    overrides: Partial<DownloadItem> = {}
): DownloadItem {
    return {
        id: value.xtreamId,
        playlistId: value.playlistId,
        xtreamId: value.xtreamId,
        contentType: value.contentType,
        seriesXtreamId: value.seriesXtreamId,
        seasonNumber: value.seasonNumber,
        episodeNumber: value.episodeNumber,
        title: `Episode ${value.episodeNumber}`,
        url: 'https://stream.invalid/download',
        status: 'queued',
        ...overrides,
    };
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function loggedText(spy: jest.SpyInstance): string {
    return spy.mock.calls
        .flat()
        .map((value) =>
            value instanceof Error
                ? `${value.message}\n${value.stack ?? ''}`
                : typeof value === 'string'
                  ? value
                  : JSON.stringify(value)
        )
        .join('\n');
}
