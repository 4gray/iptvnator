import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SeasonContainerComponent } from '@iptvnator/ui/components';
import type { M3uSeriesMenuService as ServiceType } from './m3u-series-menu.service';

// The shared components barrel reaches video.js, whose CJS bundle cannot be
// evaluated under the ESM jest environment.
jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

describe('M3uSeriesMenuService', () => {
    let M3uSeriesMenuService: typeof ServiceType;

    beforeAll(async () => {
        ({ M3uSeriesMenuService } = await import('./m3u-series-menu.service'));
    });

    const batchRunning = signal(false);
    const eligible = signal(3);
    const watchPresenter = {
        seasonWatchToggleVisible: signal(true),
        selectedSeasonFullyWatched: signal(false),
        seasonWatchEligibleCount: eligible,
        seriesMenuVisible: signal(true),
        seriesFullyWatched: signal(false),
        seriesWatchEligibleCount: signal(5),
        seriesCountKnown: signal(true),
        seriesActionDisabled: signal(false),
        toggleSeasonWatched: jest.fn(),
        toggleSeriesWatched: jest.fn(),
    };
    const container = signal<SeasonContainerComponent | undefined>(undefined);

    function create(): ServiceType {
        TestBed.configureTestingModule({ providers: [M3uSeriesMenuService] });
        const service = TestBed.inject(M3uSeriesMenuService);
        service.connect(container);
        return service;
    }

    const rows = (service: ServiceType) =>
        service.sections().flatMap((section) => section.items);

    beforeEach(() => {
        TestBed.resetTestingModule();
        batchRunning.set(false);
        eligible.set(3);
        watchPresenter.toggleSeasonWatched.mockReset();
        watchPresenter.toggleSeriesWatched.mockReset();
        container.set({
            watchPresenter,
            seasonWatchBatchRunning: batchRunning,
        } as unknown as SeasonContainerComponent);
    });

    it('offers only the season and series watched rows', () => {
        expect(rows(create()).map((row) => row.testId)).toEqual([
            'toggle-season-watched',
            'toggle-series-watched',
        ]);
    });

    it('offers nothing before the season grid exists', () => {
        container.set(undefined);

        expect(rows(create())).toEqual([]);
    });

    it('starts the toggle the chosen row names', () => {
        const service = create();

        service.run('season-watched');
        expect(watchPresenter.toggleSeasonWatched).toHaveBeenCalledTimes(1);
        expect(watchPresenter.toggleSeriesWatched).not.toHaveBeenCalled();

        service.run('series-watched');
        expect(watchPresenter.toggleSeriesWatched).toHaveBeenCalledTimes(1);

        service.run('download-season');
        expect(watchPresenter.toggleSeasonWatched).toHaveBeenCalledTimes(1);
    });

    it('disables the season row while a batch persists or nothing is left to mark', () => {
        const service = create();
        const season = () =>
            rows(service).find((row) => row.testId === 'toggle-season-watched');
        expect(season()?.disabled).toBe(false);

        batchRunning.set(true);
        expect(season()?.disabled).toBe(true);

        batchRunning.set(false);
        eligible.set(0);
        expect(season()?.disabled).toBe(true);
    });
});
