import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Channel } from '@iptvnator/shared/interfaces';
import { M3uCatalogIndexService } from './m3u-catalog-index.service';

const channel = (url: string, name: string, group: string) =>
    ({ url, name, group: { title: group } }) as unknown as Channel;

const LIVE = channel('http://h.example/live/u/p/1.ts', 'TRT 1', 'Ulusal');
const MOVIE = channel('http://h.example/movie/u/p/2.mkv', 'Dune', 'Films');
const EPISODE = channel(
    'http://h.example/series/u/p/3.mp4',
    'Dark S01E01',
    'Shows'
);

describe('M3uCatalogIndexService', () => {
    const channels = signal<Channel[]>([]);

    beforeEach(() => {
        channels.set([]);
        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: { selectSignal: () => channels } },
            ],
        });
    });

    it('splits the loaded channels by kind', () => {
        channels.set([LIVE, MOVIE, EPISODE]);
        const service = TestBed.inject(M3uCatalogIndexService);

        expect(service.index().counts).toEqual({
            live: 1,
            movie: 1,
            episode: 1,
            radio: 0,
        });
        expect(service.channelsOfKind('movie')()).toEqual([MOVIE]);
        expect(
            service
                .groupsOfKind('episode')()
                .map((g) => g.title)
        ).toEqual(['Shows']);
    });

    it('reports a live-only playlist as having no other content', () => {
        channels.set([LIVE]);
        const service = TestBed.inject(M3uCatalogIndexService);

        expect(service.hasNonLiveContent()).toBe(false);
    });

    it('reuses the index while the channel array is unchanged', () => {
        channels.set([LIVE, MOVIE]);
        const service = TestBed.inject(M3uCatalogIndexService);

        // Identity, not equality: the whole point of the memo is that
        // consumers can compare references instead of re-deriving.
        expect(service.index()).toBe(service.index());
    });

    it('rebuilds when the store replaces the channel array', () => {
        channels.set([LIVE]);
        const service = TestBed.inject(M3uCatalogIndexService);
        const before = service.index();

        channels.set([LIVE, MOVIE]);

        expect(service.index()).not.toBe(before);
        expect(service.index().counts.movie).toBe(1);
    });

    it('survives an empty playlist', () => {
        const service = TestBed.inject(M3uCatalogIndexService);

        expect(service.index().counts.live).toBe(0);
        expect(service.hasNonLiveContent()).toBe(false);
    });
});
