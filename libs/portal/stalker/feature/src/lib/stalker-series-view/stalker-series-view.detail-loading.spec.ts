import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';
import { createStalkerSeriesViewHarness } from './stalker-series-view.test-harness';
import { StubSeasonContainerComponent } from './stalker-series-view.test-helpers';

/**
 * The inline player's "Up Next" rail across lazy Ministra VOD-series seasons:
 * the season after the playing one is fetched ahead so the rail can spill
 * over into it.
 */
describe('StalkerSeriesViewComponent detail list loading', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    const {
        selectedContentType,
        selectedItem,
        serialSeasonsResource,
        vodSeriesSeasonsResource,
        fetchVodSeriesEpisodes,
        createFixture,
    } = createStalkerSeriesViewHarness(() => jest.fn());

    async function stabilize(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
    }

    beforeEach(async () => {
        fixture = await createFixture();
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('keeps the loaded detail season on screen while the fullscreen picker loads another', async () => {
        // The fullscreen episode picker reports through onSeasonSelected
        // too, but does not change the detail container's season: loading
        // the picked lazy season must not turn the detail rows into
        // skeletons.
        selectedContentType.set('vod');
        selectedItem.set({
            id: '50001',
            is_series: true,
            info: {
                name: 'VOD Flagged Series',
                description: 'Lazy seasons',
                movie_image: 'vod-series.jpg',
            },
        });
        serialSeasonsResource.set([]);
        vodSeriesSeasonsResource.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
            },
        ]);
        await stabilize();
        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    { id: 'episode-1', series_number: 1, name: 'Pilot' },
                ],
                isLoading: false,
                isExpanded: false,
            },
            {
                id: 'season-2',
                video_id: '50001',
                season_number: '2',
                name: 'Season 2',
                episodes: [],
                isLoading: false,
                isExpanded: false,
            },
        ]);
        // Season 2's portal request never answers during the test.
        fetchVodSeriesEpisodes.mockClear();
        fetchVodSeriesEpisodes.mockReturnValue(new Promise(() => undefined));
        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        ).componentInstance as StubSeasonContainerComponent;
        seasonContainer.selectedSeason.set('1');
        await stabilize();
        expect(seasonContainer.isLoading()).toBe(false);

        fixture.componentInstance.onSeasonSelected('2');
        await stabilize();
        expect(fetchVodSeriesEpisodes).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance.isCurrentSeasonLoading('2')).toBe(
            true
        );
        // The detail container still shows season 1.
        expect(seasonContainer.isLoading()).toBe(false);

        // Once the container itself moves to season 2, it is loading.
        seasonContainer.selectedSeason.set('2');
        await stabilize();
        expect(seasonContainer.isLoading()).toBe(true);
    });
});
