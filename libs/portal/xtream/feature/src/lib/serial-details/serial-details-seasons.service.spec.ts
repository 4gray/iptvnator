import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import type { XtreamSerieDetailsView } from './serial-details-playback.service';
import { SerialDetailsSeasonsService } from './serial-details-seasons.service';

describe('SerialDetailsSeasonsService', () => {
    const pendingSeasons = new Set<string>();
    const store = {
        isTmdbEpisodeMetadataPending: jest.fn((seasonKey: string) =>
            pendingSeasons.has(seasonKey)
        ),
        enrichSelectedSerialSeason: jest.fn(),
    };
    const item = signal<XtreamSerieDetailsView | null>({
        info: { tmdb_id: 777 },
        episodes: { '1': [], '2': [] },
    } as unknown as XtreamSerieDetailsView);
    let service: SerialDetailsSeasonsService;

    beforeEach(() => {
        pendingSeasons.clear();
        store.enrichSelectedSerialSeason.mockClear();
        TestBed.configureTestingModule({
            providers: [
                SerialDetailsSeasonsService,
                { provide: XtreamStore, useValue: store },
            ],
        });
        service = TestBed.inject(SerialDetailsSeasonsService);
    });

    it('follows the detail container, not the fullscreen picker, for metadata loading', () => {
        // Season 2's enrichment is outstanding; the detail container shows
        // season 1, which has settled.
        pendingSeasons.add('2');
        const detailSeasonKey = signal<string | null>('1');
        service.bind({ selectedItem: item, detailSeasonKey });
        expect(service.metadataLoading()).toBe(false);

        // The fullscreen picker chooses season 2: it gets enriched, but the
        // detail rows of season 1 must stay.
        service.select('2');
        TestBed.flushEffects();
        expect(store.enrichSelectedSerialSeason).toHaveBeenCalledWith('2');
        expect(service.metadataLoading()).toBe(false);

        // Only once the container itself moves to season 2 is it loading.
        detailSeasonKey.set('2');
        expect(service.metadataLoading()).toBe(true);
    });

    it('stands in with the lowest season before the container reports one', () => {
        pendingSeasons.add('1');
        service.bind({ selectedItem: item });
        expect(service.metadataLoading()).toBe(true);

        pendingSeasons.delete('1');
        pendingSeasons.add('2');
        service.bind({ selectedItem: item });
        expect(service.metadataLoading()).toBe(false);
    });
});
