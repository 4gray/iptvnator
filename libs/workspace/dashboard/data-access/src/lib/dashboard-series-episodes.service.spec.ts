import { TestBed } from '@angular/core/testing';
import { XtreamApiService } from '@iptvnator/portal/xtream/data-access';
import type { XtreamSerieDetails } from '@iptvnator/shared/interfaces';
import {
    DASHBOARD_SERIES_EPISODES_MAX_AGE_MS,
    DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS,
    DashboardSeriesEpisodesService,
    dashboardSeriesEpisodesKey,
    sameDashboardSeriesEpisodesRequests,
    type DashboardSeriesEpisodesRequest,
} from './dashboard-series-episodes.service';

const credentials = {
    serverUrl: 'http://provider.example',
    username: 'user',
    password: 'pass',
};

function request(seriesId: number): DashboardSeriesEpisodesRequest {
    return { playlistId: 'xtream-1', seriesId, credentials };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('DashboardSeriesEpisodesService', () => {
    let getSeriesInfo: jest.Mock;
    let service: DashboardSeriesEpisodesService;
    const status = (seriesId: number) =>
        service.episodes().get(dashboardSeriesEpisodesKey('xtream-1', seriesId))
            ?.status;

    beforeEach(() => {
        getSeriesInfo = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                { provide: XtreamApiService, useValue: { getSeriesInfo } },
            ],
        });
        service = TestBed.inject(DashboardSeriesEpisodesService);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    it('loads each series once with its playlist credentials', async () => {
        const pending = deferred<XtreamSerieDetails>();
        getSeriesInfo.mockReturnValue(pending.promise);

        service.request([request(900)]);
        service.request([request(900)]);
        expect(status(900)).toBe('loading');

        const seasons = { '1': [{ id: '901', episode_num: 1 }] };
        pending.resolve({ episodes: seasons } as unknown as XtreamSerieDetails);
        await pending.promise;
        await Promise.resolve();

        expect(getSeriesInfo).toHaveBeenCalledTimes(1);
        // A background lookup: a failure must not raise an error toast.
        expect(getSeriesInfo).toHaveBeenCalledWith(credentials, 900, {
            suppressErrorLog: true,
        });
        expect(
            service.episodes().get(dashboardSeriesEpisodesKey('xtream-1', 900))
        ).toEqual({ status: 'loaded', seasons });

        service.request([request(900)]);
        expect(getSeriesInfo).toHaveBeenCalledTimes(1);
    });

    it('runs at most two lookups at once', async () => {
        const answers = [1, 2, 3].map(() => deferred<XtreamSerieDetails>());
        answers.forEach((answer) =>
            getSeriesInfo.mockReturnValueOnce(answer.promise)
        );

        service.request([request(1), request(2), request(3)]);
        expect(getSeriesInfo).toHaveBeenCalledTimes(2);
        expect(status(3)).toBe('loading');

        answers[0].resolve({ episodes: {} } as unknown as XtreamSerieDetails);
        await answers[0].promise;
        await new Promise((resolve) => setTimeout(resolve));

        expect(getSeriesInfo).toHaveBeenCalledTimes(3);
        expect(getSeriesInfo).toHaveBeenLastCalledWith(credentials, 3, {
            suppressErrorLog: true,
        });
    });

    describe('in lookup rounds', () => {
        const flush = () => new Promise((resolve) => setTimeout(resolve));
        const entry = (seriesId: number) =>
            service
                .episodes()
                .get(dashboardSeriesEpisodesKey('xtream-1', seriesId));
        const seasons = (...ids: number[]) => ({
            '1': ids.map((id, index) => ({
                id: String(id),
                episode_num: index + 1,
            })),
        });
        let now: number;

        beforeEach(() => {
            now = Date.UTC(2026, 9, 5, 8);
            jest.spyOn(Date, 'now').mockImplementation(() => now);
        });

        it('retries a failed lookup only in a later round, after the retry delay', async () => {
            getSeriesInfo.mockRejectedValueOnce(
                new Error('Portal is not responding')
            );
            service.request([request(900)], 1);
            await flush();
            expect(status(900)).toBe('failed');

            // More series to look past in the same round: no retry.
            service.request([request(900), request(901)], 1);
            expect(getSeriesInfo).toHaveBeenCalledTimes(2);
            expect(getSeriesInfo).toHaveBeenLastCalledWith(credentials, 901, {
                suppressErrorLog: true,
            });

            // A later round too soon after the failure: the portal is left
            // alone, whatever the user does on the dashboard.
            service.request([request(900)], 2);
            expect(getSeriesInfo).toHaveBeenCalledTimes(2);

            now += DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS;
            getSeriesInfo.mockResolvedValueOnce({ episodes: seasons(901) });
            service.request([request(900)], 3);
            expect(getSeriesInfo).toHaveBeenCalledTimes(3);
            await flush();
            expect(status(900)).toBe('loaded');
        });

        it('stops asking a source after two failures in a row, until the retry delay has passed', async () => {
            getSeriesInfo
                .mockRejectedValueOnce(new Error('Portal is not responding'))
                .mockRejectedValueOnce(new Error('Portal is not responding'));
            service.request([1, 2, 3, 4].map(request), 1);
            await flush();

            // The first two answered for the portal: the rest are not asked.
            expect(getSeriesInfo).toHaveBeenCalledTimes(2);
            expect([1, 2, 3, 4].map(status)).toEqual([
                'failed',
                'failed',
                'failed',
                'failed',
            ]);

            // Another source is unaffected.
            const other: DashboardSeriesEpisodesRequest = {
                playlistId: 'xtream-2',
                seriesId: 5,
                credentials: {
                    ...credentials,
                    serverUrl: 'http://other.example',
                },
            };
            getSeriesInfo.mockResolvedValueOnce({ episodes: seasons(51) });
            service.request([other], 1);
            await flush();
            expect(getSeriesInfo).toHaveBeenCalledTimes(3);
            expect(
                service
                    .episodes()
                    .get(dashboardSeriesEpisodesKey('xtream-2', 5))?.status
            ).toBe('loaded');

            // A later round before the delay: still left alone.
            service.request([1, 2, 3, 4].map(request), 2);
            expect(getSeriesInfo).toHaveBeenCalledTimes(3);

            now += DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS;
            getSeriesInfo.mockResolvedValue({ episodes: seasons(9) });
            service.request([1, 2, 3, 4].map(request), 3);
            await flush();
            await flush();
            expect(getSeriesInfo).toHaveBeenCalledTimes(7);
            expect([1, 2, 3, 4].map(status)).toEqual([
                'loaded',
                'loaded',
                'loaded',
                'loaded',
            ]);
        });

        it('asks a source that stopped answering again at once with a corrected password', async () => {
            getSeriesInfo
                .mockRejectedValueOnce(new Error('Wrong password'))
                .mockRejectedValueOnce(new Error('Wrong password'));
            service.request([1, 2, 3].map(request), 1);
            await flush();
            expect(getSeriesInfo).toHaveBeenCalledTimes(2);
            expect(status(3)).toBe('failed');

            const corrected = (seriesId: number) => ({
                ...request(seriesId),
                credentials: { ...credentials, password: 'corrected' },
            });
            getSeriesInfo.mockResolvedValue({ episodes: seasons(9) });
            service.request([1, 2, 3].map(corrected), 1);
            await flush();
            await flush();
            expect(getSeriesInfo).toHaveBeenCalledTimes(5);
            expect([1, 2, 3].map(status)).toEqual([
                'loaded',
                'loaded',
                'loaded',
            ]);
        });

        it('tries a password corrected while the lookup was in flight once the old one fails', async () => {
            const corrected = (seriesId: number) => ({
                ...request(seriesId),
                credentials: { ...credentials, password: 'corrected' },
            });
            const stale = deferred<XtreamSerieDetails>();
            getSeriesInfo.mockReturnValueOnce(stale.promise);
            service.request([request(900)], 1);
            expect(getSeriesInfo).toHaveBeenCalledTimes(1);

            // The playlist is edited while the lookup is out.
            service.request([corrected(900)], 1);
            expect(getSeriesInfo).toHaveBeenCalledTimes(1);

            getSeriesInfo.mockResolvedValueOnce({ episodes: seasons(901) });
            stale.reject(new Error('Wrong password'));
            await flush();

            expect(getSeriesInfo).toHaveBeenCalledTimes(2);
            expect(getSeriesInfo).toHaveBeenLastCalledWith(
                corrected(900).credentials,
                900,
                { suppressErrorLog: true }
            );
            expect(status(900)).toBe('loaded');

            // A list that loaded anyway needs no second lookup.
            const pending = deferred<XtreamSerieDetails>();
            getSeriesInfo.mockReturnValueOnce(pending.promise);
            service.request(
                [
                    {
                        ...request(910),
                        credentials: { ...credentials, password: 'corrected' },
                    },
                ],
                1
            );
            service.request(
                [
                    {
                        ...request(910),
                        credentials: { ...credentials, password: 'newer' },
                    },
                ],
                1
            );
            pending.resolve({
                episodes: seasons(911),
            } as unknown as XtreamSerieDetails);
            await flush();
            expect(getSeriesInfo).toHaveBeenCalledTimes(3);
            expect(status(910)).toBe('loaded');
        });

        it('leaves a list whose refresh failed alone until the retry delay has passed', async () => {
            getSeriesInfo.mockResolvedValueOnce({ episodes: seasons(901) });
            service.request([request(900)], 1);
            await flush();

            now += DASHBOARD_SERIES_EPISODES_MAX_AGE_MS;
            getSeriesInfo.mockRejectedValueOnce(new Error('Too many requests'));
            service.request([request(900)], 2);
            await flush();
            expect(getSeriesInfo).toHaveBeenCalledTimes(2);

            // Still past its age, but the refresh just failed.
            service.request([request(900)], 3);
            expect(getSeriesInfo).toHaveBeenCalledTimes(2);
            expect(entry(900)).toEqual({
                status: 'loaded',
                seasons: seasons(901),
            });

            now += DASHBOARD_SERIES_EPISODES_RETRY_DELAY_MS;
            getSeriesInfo.mockResolvedValueOnce({
                episodes: seasons(901, 902),
            });
            service.request([request(900)], 4);
            await flush();
            expect(getSeriesInfo).toHaveBeenCalledTimes(3);
            expect(entry(900)).toEqual({
                status: 'loaded',
                seasons: seasons(901, 902),
            });
        });

        it('retries a failed lookup at once with a corrected password, without refetching loaded lists', async () => {
            const corrected = (seriesId: number) => ({
                ...request(seriesId),
                credentials: { ...credentials, password: 'corrected' },
            });
            getSeriesInfo
                .mockRejectedValueOnce(new Error('Wrong password'))
                .mockResolvedValueOnce({ episodes: seasons(911) });
            service.request([request(900), request(910)], 1);
            await flush();
            expect(status(900)).toBe('failed');
            expect(status(910)).toBe('loaded');

            getSeriesInfo.mockResolvedValueOnce({ episodes: seasons(901) });
            service.request([corrected(900), corrected(910)], 1);

            expect(getSeriesInfo).toHaveBeenCalledTimes(3);
            expect(getSeriesInfo).toHaveBeenLastCalledWith(
                corrected(900).credentials,
                900,
                { suppressErrorLog: true }
            );
            await flush();
            expect(status(900)).toBe('loaded');
        });

        it('refreshes a list past its age in a later round, the old one standing meanwhile', async () => {
            getSeriesInfo.mockResolvedValueOnce({ episodes: seasons(901) });
            service.request([request(900)], 1);
            await flush();

            // Still current, even in a later round.
            service.request([request(900)], 2);
            now += DASHBOARD_SERIES_EPISODES_MAX_AGE_MS;
            // Past its age, but the same round.
            service.request([request(900)], 2);
            expect(getSeriesInfo).toHaveBeenCalledTimes(1);

            const refresh = deferred<XtreamSerieDetails>();
            getSeriesInfo.mockReturnValueOnce(refresh.promise);
            service.request([request(900)], 3);
            expect(getSeriesInfo).toHaveBeenCalledTimes(2);
            expect(entry(900)).toEqual({
                status: 'loaded',
                seasons: seasons(901),
            });

            refresh.resolve({
                episodes: seasons(901, 902),
            } as unknown as XtreamSerieDetails);
            await flush();
            expect(entry(900)).toEqual({
                status: 'loaded',
                seasons: seasons(901, 902),
            });
        });

        it('keeps the list when its refresh fails', async () => {
            getSeriesInfo.mockResolvedValueOnce({ episodes: seasons(901) });
            service.request([request(900)], 1);
            await flush();

            now += DASHBOARD_SERIES_EPISODES_MAX_AGE_MS;
            getSeriesInfo.mockRejectedValueOnce(new Error('Too many requests'));
            service.request([request(900)], 2);
            await flush();

            expect(getSeriesInfo).toHaveBeenCalledTimes(2);
            expect(entry(900)).toEqual({
                status: 'loaded',
                seasons: seasons(901),
            });
        });

        it('looks a series up again for another source, and ignores the old answer', async () => {
            const moved = {
                ...request(900),
                credentials: {
                    ...credentials,
                    serverUrl: 'http://moved.example',
                },
            };
            getSeriesInfo.mockResolvedValueOnce({ episodes: seasons(901) });
            service.request([request(900)], 1);
            await flush();

            // Another server: the old provider's list must not stand.
            const movedAnswer = deferred<XtreamSerieDetails>();
            const backAnswer = deferred<XtreamSerieDetails>();
            getSeriesInfo
                .mockReturnValueOnce(movedAnswer.promise)
                .mockReturnValueOnce(backAnswer.promise);
            service.request([moved], 1);
            expect(entry(900)).toEqual({ status: 'loading' });
            expect(getSeriesInfo).toHaveBeenLastCalledWith(
                moved.credentials,
                900,
                { suppressErrorLog: true }
            );
            // And back, with the answer for the moved source still out.
            service.request([request(900)], 1);

            movedAnswer.resolve({
                episodes: seasons(7),
            } as unknown as XtreamSerieDetails);
            await flush();
            expect(entry(900)).toEqual({ status: 'loading' });

            backAnswer.resolve({
                episodes: seasons(901, 902),
            } as unknown as XtreamSerieDetails);
            await flush();
            expect(entry(900)).toEqual({
                status: 'loaded',
                seasons: seasons(901, 902),
            });
        });
    });
});

describe('sameDashboardSeriesEpisodesRequests', () => {
    it('tells request lists apart by series, order and credentials only', () => {
        const same = sameDashboardSeriesEpisodesRequests;

        expect(same([request(1), request(2)], [request(1), request(2)])).toBe(
            true
        );
        expect(same([request(1), request(2)], [request(2), request(1)])).toBe(
            false
        );
        expect(same([request(1)], [request(1), request(2)])).toBe(false);
        expect(
            same([request(1)], [{ ...request(1), playlistId: 'xtream-2' }])
        ).toBe(false);
        for (const field of ['serverUrl', 'username', 'password'] as const) {
            expect(
                same(
                    [request(1)],
                    [
                        {
                            ...request(1),
                            credentials: { ...credentials, [field]: 'changed' },
                        },
                    ]
                )
            ).toBe(false);
        }
    });
});
