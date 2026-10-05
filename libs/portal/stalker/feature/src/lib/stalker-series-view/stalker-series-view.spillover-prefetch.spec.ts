import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';
import { createStalkerSeriesViewHarness } from './stalker-series-view.test-harness';
import { StubPortalInlinePlayerComponent } from './stalker-series-view.test-helpers';

/**
 * The inline player's "Up Next" rail across lazy Ministra VOD-series seasons:
 * the season after the playing one is fetched ahead so the rail can spill
 * over into it.
 */
describe('StalkerSeriesViewComponent Up Next spillover prefetch', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    const {
        selectedContentType,
        selectedItem,
        serialSeasonsResource,
        vodSeriesSeasonsResource,
        fetchVodSeriesEpisodes,
        isEmbeddedPlayer,
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

    it('prefetches the next unopened season so the Up Next rail can spill over', async () => {
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
        isEmbeddedPlayer.mockReturnValue(true);

        await stabilize();

        // Season 1 loaded, season 2 still empty — the state a user is in
        // right after opening the series and starting the first episode.
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
        fetchVodSeriesEpisodes.mockClear();
        fetchVodSeriesEpisodes.mockResolvedValue([
            { id: 'episode-3', series_number: 1, name: 'Next Season' },
        ]);

        const firstEpisode = fixture.componentInstance.mappedSeasons()['1'][0];
        fixture.componentInstance.onEpisodeClicked(firstEpisode);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledWith(
            '50001',
            'season-2'
        );

        const inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        const railItems = inlinePlayer.upNextEpisodes() as Array<{
            label: string;
        }>;
        expect(railItems.map((item) => item.label)).toEqual([
            'S01E01',
            'S02E01',
        ]);
    });

    it('does not re-request a spillover season that came back empty', async () => {
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
        isEmbeddedPlayer.mockReturnValue(true);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    { id: 'episode-1', series_number: 1, name: 'Pilot' },
                    { id: 'episode-2', series_number: 2, name: 'Second' },
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
        fetchVodSeriesEpisodes.mockClear();
        // Failed or genuinely empty season: isLoading returns to false while
        // episodes stays empty — the retry trap.
        fetchVodSeriesEpisodes.mockResolvedValue([]);

        const seasonOne = fixture.componentInstance.mappedSeasons()['1'];
        fixture.componentInstance.onEpisodeClicked(seasonOne[0]);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledTimes(1);

        // Further playback activity in the same season must not retrigger it.
        fixture.componentInstance.onEpisodeClicked(seasonOne[1]);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledTimes(1);
    });

    it('retries a failed spillover prefetch on the next episode', async () => {
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
        isEmbeddedPlayer.mockReturnValue(true);

        await stabilize();

        fixture.componentInstance.vodSeriesSeasons.set([
            {
                id: 'season-1',
                video_id: '50001',
                season_number: '1',
                name: 'Season 1',
                episodes: [
                    { id: 'episode-1', series_number: 1, name: 'Pilot' },
                    { id: 'episode-2', series_number: 2, name: 'Second' },
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
        fetchVodSeriesEpisodes.mockClear();
        fetchVodSeriesEpisodes.mockRejectedValueOnce(new Error('network'));

        const seasonOne = fixture.componentInstance.mappedSeasons()['1'];
        fixture.componentInstance.onEpisodeClicked(seasonOne[0]);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        // The failure must not loop while the same episode keeps playing.
        expect(fetchVodSeriesEpisodes).toHaveBeenCalledTimes(1);

        // Moving to the next episode gives the transient failure a new chance.
        fetchVodSeriesEpisodes.mockResolvedValue([
            { id: 'episode-3', series_number: 1, name: 'Next Season' },
        ]);
        fixture.componentInstance.onEpisodeClicked(seasonOne[1]);
        await fixture.whenStable();
        await stabilize();
        fixture.detectChanges();

        expect(fetchVodSeriesEpisodes).toHaveBeenCalledTimes(2);

        const inlinePlayer = fixture.debugElement.query(
            By.directive(StubPortalInlinePlayerComponent)
        ).componentInstance as StubPortalInlinePlayerComponent;
        const railItems = inlinePlayer.upNextEpisodes() as Array<{
            label: string;
        }>;
        expect(railItems.map((item) => item.label)).toEqual([
            'S01E02',
            'S02E01',
        ]);
    });
});
