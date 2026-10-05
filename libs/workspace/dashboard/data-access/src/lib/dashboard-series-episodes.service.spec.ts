import { TestBed } from '@angular/core/testing';
import { XtreamApiService } from '@iptvnator/portal/xtream/data-access';
import type { XtreamSerieDetails } from '@iptvnator/shared/interfaces';
import {
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

    it('reports a failed lookup and retries it when asked again', async () => {
        const failure = deferred<XtreamSerieDetails>();
        getSeriesInfo.mockReturnValueOnce(failure.promise);

        service.request([request(900)]);
        failure.reject(new Error('Portal is not responding'));
        await failure.promise.catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve));
        expect(status(900)).toBe('failed');

        getSeriesInfo.mockResolvedValueOnce({ episodes: {} });
        service.request([request(900)]);
        expect(getSeriesInfo).toHaveBeenCalledTimes(2);
        await new Promise((resolve) => setTimeout(resolve));
        expect(status(900)).toBe('loaded');
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
