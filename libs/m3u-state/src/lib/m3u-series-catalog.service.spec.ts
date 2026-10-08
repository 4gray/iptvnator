import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Channel } from '@iptvnator/shared/interfaces';
import { M3uSeriesCatalogService } from './m3u-series-catalog.service';
import { selectActivePlaylistId, selectChannelsLoading } from './selectors';

const channel = (url: string, name: string, group: string) =>
    ({ url, name, group: { title: group } }) as unknown as Channel;

const LIVE = channel('http://h.example/live/u/p/1.ts', 'TRT 1', 'Ulusal');
const MOVIE = channel('http://h.example/movie/u/p/2.mkv', 'Dune', 'Films');

describe('M3uSeriesCatalogService', () => {
    const channels = signal<Channel[]>([]);
    const playlistId = signal('pl-1');
    const loading = signal(false);

    beforeEach(() => {
        channels.set([]);
        playlistId.set('pl-1');
        loading.set(false);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: Store,
                    useValue: {
                        // Selector-aware: the series key is built from the
                        // playlist id, so handing back the channel signal
                        // for every selector would make the key meaningless
                        // and hide a regression in it.
                        selectSignal: (selector: unknown) =>
                            selector === selectActivePlaylistId
                                ? playlistId
                                : selector === selectChannelsLoading
                                  ? loading
                                  : channels,
                    },
                },
            ],
        });
    });

    const episode = (name: string) =>
        channel(
            `http://h.example/series/u/p/${encodeURIComponent(name)}.mp4`,
            name,
            'Shows'
        );

    it('collapses episodes into series keyed by the active playlist', () => {
        channels.set([episode('SHOW S1 E1'), episode('SHOW S1 E2')]);
        const service = TestBed.inject(M3uSeriesCatalogService);

        expect(service.series()).toHaveLength(1);
        expect(service.series()[0].episodeCount).toBe(2);
        expect(service.series()[0].key).toContain('pl-1');
    });

    it('indexes series by their stable id', () => {
        channels.set([episode('SHOW S1 E1')]);
        const service = TestBed.inject(M3uSeriesCatalogService);
        const only = service.series()[0];

        expect(service.seriesById().get(only.id)).toBe(only);
    });

    it('rekeys when the active playlist changes', () => {
        channels.set([episode('SHOW S1 E1')]);
        const service = TestBed.inject(M3uSeriesCatalogService);
        const before = service.series()[0].key;

        playlistId.set('pl-2');

        expect(service.series()[0].key).not.toBe(before);
    });

    it('is empty for a playlist with no episodes', () => {
        channels.set([LIVE, MOVIE]);
        const service = TestBed.inject(M3uSeriesCatalogService);

        expect(service.series()).toEqual([]);
    });

    it('is empty while the next playlist is loading', () => {
        // A playlist switch leaves the previous playlist's rows in the store
        // until the new ones arrive, under the new playlist's id.
        channels.set([episode('SHOW S1 E1')]);
        const service = TestBed.inject(M3uSeriesCatalogService);
        expect(service.series()).toHaveLength(1);

        loading.set(true);

        expect(service.series()).toEqual([]);
        expect(service.seriesById().size).toBe(0);
    });
});
