import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';
import { createStalkerSeriesViewHarness } from './stalker-series-view.test-harness';
import { StubSeasonContainerComponent } from './stalker-series-view.test-helpers';

/**
 * The lazy TMDB season fetch of the Stalker series view: when it runs
 * relative to the show-level TMDB match and the season resource, and which
 * TMDB season it asks for.
 */
describe('StalkerSeriesViewComponent TMDB season fetch', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    const {
        selectedItem,
        serialSeasonsResource,
        isSerialSeasonsLoading,
        tmdbGetSeason,
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

    it('fetches the TMDB season once the show-level match arrives after auto-select', async () => {
        await stabilize();
        fixture.detectChanges();

        // Season tabs auto-select immediately — usually before the async
        // show-level enrichment has written tmdb_id.
        const seasonContainer = fixture.debugElement.query(
            By.directive(StubSeasonContainerComponent)
        ).componentInstance as StubSeasonContainerComponent;
        seasonContainer.seasonSelected.emit('1');
        await stabilize();
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        // The TMDB match lands afterwards — the fetch must run now.
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series',
                description: 'Series description',
                movie_image: 'poster.jpg',
                tmdb_id: 777,
            },
        } as never);
        await stabilize();

        expect(tmdbGetSeason).toHaveBeenCalledWith(777, 1);
    });

    it('waits for the season map before fetching so a per-season slice gets the title-marked season', async () => {
        serialSeasonsResource.set([]);
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series (2 season)',
                description: 'Series description',
                movie_image: 'poster.jpg',
                tmdb_id: 777,
            },
        } as never);
        await stabilize();

        fixture.componentInstance.onSeasonSelected('2');
        await stabilize();

        // Season resource still loading — fetching now would pass a zero
        // season count, suppress the title-marker override and cache the
        // wrong season forever (fetchSeason is idempotent).
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        serialSeasonsResource.set([
            {
                id: 'season-1',
                name: 'Season 1',
                cmd: '/media/file_30001.mpg',
                series: [1, 2],
            },
        ]);
        await stabilize();

        // Single-season slice whose provider season is renumbered to 1:
        // the title marker names the real TMDB season.
        expect(tmdbGetSeason).toHaveBeenCalledWith(777, 2);
    });

    it('gates the fetch on the reloading season resource during detail-to-detail navigation', async () => {
        await stabilize();

        fixture.componentInstance.onSeasonSelected('1');
        await stabilize();
        // No show-level TMDB match yet — nothing fetched for the first item
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        // Detail-to-detail navigation reuses the component; the new item's
        // TMDB match can arrive while the season resource reloads and the
        // map still shows the previous series' seasons.
        isSerialSeasonsLoading.set(true);
        selectedItem.set({
            id: '30002',
            cmd: '/media/file_30002.mpg',
            info: {
                name: 'Other Series (2 season)',
                description: 'Other description',
                movie_image: 'poster2.jpg',
                tmdb_id: 888,
            },
        } as never);
        await stabilize();

        // The new tmdb_id must NOT pair with the previous series' season
        // context while the resource reloads.
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        // Once the new item's own seasons land, the fetch runs without a
        // stale-season fetch. The container selects the corrected key once
        // the new season map is rendered.
        serialSeasonsResource.set([
            {
                id: 'season-1',
                name: 'Season 1',
                cmd: '/media/file_30002.mpg',
                series: [1, 2],
            },
        ]);
        isSerialSeasonsLoading.set(false);
        fixture.componentInstance.onSeasonSelected('2');
        await stabilize();
        expect(tmdbGetSeason).toHaveBeenCalledWith(888, 2);
    });

    it('enriches after equal-id navigation once the season resource settles', async () => {
        await stabilize();
        fixture.componentInstance.onSeasonSelected('1');
        await stabilize();

        // Distinct items can reuse a provider id; the loading gate (not an
        // id comparison) keeps the stale map from being used.
        isSerialSeasonsLoading.set(true);
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Different Series (3 season)',
                description: 'Different description',
                movie_image: 'poster3.jpg',
                tmdb_id: 999,
            },
        } as never);
        await stabilize();
        expect(tmdbGetSeason).not.toHaveBeenCalled();

        isSerialSeasonsLoading.set(false);
        fixture.componentInstance.onSeasonSelected('3');
        await stabilize();
        expect(tmdbGetSeason).toHaveBeenCalledWith(999, 3);
    });

    it('reads the season marker from o_name when name is generic', async () => {
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series',
                o_name: 'Regular Series (2 season)',
                description: 'Series description',
                movie_image: 'poster.jpg',
                tmdb_id: 777,
            },
        } as never);
        await stabilize();

        fixture.componentInstance.onSeasonSelected('2');
        await stabilize();

        expect(tmdbGetSeason).toHaveBeenCalledWith(777, 2);
    });
});
