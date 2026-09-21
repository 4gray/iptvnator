import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Channel } from '@iptvnator/shared/interfaces';
import { M3uCatalogIndexService } from './m3u-catalog-index.service';
import { selectActivePlaylistId } from './selectors';

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

    const playlistId = signal('pl-1');

    beforeEach(() => {
        channels.set([]);
        playlistId.set('pl-1');
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
                                : channels,
                    },
                },
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

    describe('series layer', () => {
        const episode = (name: string) =>
            channel(
                `http://h.example/series/u/p/${encodeURIComponent(name)}.mp4`,
                name,
                'Shows'
            );

        it('collapses episodes into series keyed by the active playlist', () => {
            channels.set([episode('SHOW S1 E1'), episode('SHOW S1 E2')]);
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.series()).toHaveLength(1);
            expect(service.series()[0].episodeCount).toBe(2);
            expect(service.series()[0].key).toContain('pl-1');
        });

        it('indexes series by their stable id', () => {
            channels.set([episode('SHOW S1 E1')]);
            const service = TestBed.inject(M3uCatalogIndexService);
            const only = service.series()[0];

            expect(service.seriesById().get(only.id)).toBe(only);
        });

        it('rekeys when the active playlist changes', () => {
            channels.set([episode('SHOW S1 E1')]);
            const service = TestBed.inject(M3uCatalogIndexService);
            const before = service.series()[0].key;

            playlistId.set('pl-2');

            expect(service.series()[0].key).not.toBe(before);
        });

        it('is empty for a playlist with no episodes', () => {
            channels.set([LIVE, MOVIE]);
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.series()).toEqual([]);
        });
    });

    it('survives an empty playlist', () => {
        const service = TestBed.inject(M3uCatalogIndexService);

        expect(service.index().counts.live).toBe(0);
        expect(service.hasNonLiveContent()).toBe(false);
    });
});
