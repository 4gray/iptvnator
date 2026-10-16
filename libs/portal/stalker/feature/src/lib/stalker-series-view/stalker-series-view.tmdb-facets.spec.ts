import { ComponentFixture } from '@angular/core/testing';
import { StalkerSeriesViewComponent } from './stalker-series-view.component';
import { createStalkerSeriesViewHarness } from './stalker-series-view.test-harness';

/**
 * The view re-normalizes the selected item on every render, so the TMDB
 * genre and country facets the enrichment merged into the store item have
 * to survive that pass to become clickable Discover chips.
 */
describe('StalkerSeriesViewComponent TMDB facet chips', () => {
    let fixture: ComponentFixture<StalkerSeriesViewComponent>;
    const { selectedItem, createFixture } = createStalkerSeriesViewHarness(() =>
        jest.fn()
    );

    async function stabilize(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
    }

    function facetChipLabels(): string[] {
        return Array.from(
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                'button.meta-chip__facet'
            )
        ).map((chip) => chip.textContent?.trim() ?? '');
    }

    beforeEach(async () => {
        fixture = await createFixture();
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('renders the enriched genres and countries as Discover chips', async () => {
        await stabilize();

        // Enrichment patches the store item after selection
        selectedItem.set({
            id: '30001',
            cmd: '/media/file_30001.mpg',
            info: {
                name: 'Regular Series',
                description: 'Series description',
                movie_image: 'poster.jpg',
                genre: 'Drama',
                tmdb_id: 777,
                tmdb_genres: [
                    { id: 18, name: 'Drama' },
                    { id: 9648, name: 'Mystery' },
                ],
                tmdb_countries: [{ code: 'NO', name: 'Norway' }],
                tmdb_media_type: 'tv',
            },
        } as never);
        await stabilize();

        expect(facetChipLabels()).toEqual(
            expect.arrayContaining(['Drama', 'Mystery', 'Norway'])
        );
    });
});
