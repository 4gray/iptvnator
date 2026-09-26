import { TestBed } from '@angular/core/testing';
import { PlaylistsService, XtreamContent } from '@iptvnator/services';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { XtreamPlaylistComparisonService } from '@iptvnator/portal/xtream/data-access';
import { PlaylistComparisonComponent } from './playlist-comparison.component';

const content = (id: number, title: string): XtreamContent => ({
    id,
    category_id: 1,
    title,
    rating: '',
    added: '',
    poster_url: '',
    xtream_id: id,
    type: 'movie',
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

const completed = (items: XtreamContent[]) => ({
    status: 'completed' as const,
    content: items,
});

describe('PlaylistComparisonComponent', () => {
    let component: PlaylistComparisonComponent;
    const catalogue = jest.fn();

    beforeEach(async () => {
        catalogue.mockReset();
        catalogue.mockResolvedValue({ status: 'completed', content: [] });
        await TestBed.configureTestingModule({
            imports: [PlaylistComparisonComponent],
            providers: [
                {
                    provide: PlaylistsService,
                    useValue: {
                        getAllPlaylists: () =>
                            of([
                                {
                                    _id: 'a',
                                    title: 'A',
                                    serverUrl: 'https://a',
                                    username: 'a',
                                    password: 'a',
                                },
                                {
                                    _id: 'b',
                                    title: 'B',
                                    serverUrl: 'https://b',
                                    username: 'b',
                                    password: 'b',
                                },
                            ]),
                    },
                },
                {
                    provide: XtreamPlaylistComparisonService,
                    useValue: {
                        isXtream: () => true,
                        catalogue,
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        instant: (key: string) => key,
                    },
                },
            ],
        }).compileComponents();
        component = TestBed.createComponent(
            PlaylistComparisonComponent
        ).componentInstance;
        await component.ngOnInit();
    });

    it('keeps A and B distinct and does not load a self-comparison', async () => {
        await component.updateSelection('a', 'a');
        await component.updateSelection('b', 'a');
        expect(component.playlistA()).toBe('a');
        expect(component.playlistB()).toBe('a');
        expect(catalogue).not.toHaveBeenCalled();
    });

    it('reloads when A, B, or the active content type changes', async () => {
        await component.updateSelection('a', 'a');
        await component.updateSelection('b', 'b');
        await component.updateSelection('a', 'a');
        await component.selectType('series');
        await component.selectType('live');
        expect(catalogue).toHaveBeenCalledWith('a', 'movie');
        expect(catalogue).toHaveBeenCalledWith('b', 'movie');
        expect(catalogue).toHaveBeenCalledWith('a', 'series');
        expect(catalogue).toHaveBeenCalledWith('b', 'live');
    });

    it('exposes each result filter and empty state', () => {
        component.result.set({
            totalA: 1,
            totalB: 1,
            common: [{ bucket: 'common', a: [], b: [] }],
            onlyA: [{ bucket: 'only-a', a: [], b: [] }],
            onlyB: [{ bucket: 'only-b', a: [], b: [] }],
            ambiguous: [{ bucket: 'ambiguous', a: [], b: [] }],
        });
        component.setBucket('common');
        expect(component.selectedRows()).toHaveLength(1);
        component.setBucket('only-a');
        expect(component.selectedRows()).toHaveLength(1);
        component.setBucket('only-b');
        expect(component.selectedRows()).toHaveLength(1);
        component.setBucket('ambiguous');
        expect(component.selectedRows()).toHaveLength(1);
        component.result.set({
            totalA: 0,
            totalB: 0,
            common: [],
            onlyA: [],
            onlyB: [],
            ambiguous: [],
        });
        expect(component.selectedRows()).toEqual([]);
    });

    it('keeps unavailable and failed catalogue reads distinct', async () => {
        catalogue
            .mockResolvedValueOnce({
                status: 'completed',
                content: [content(1, 'A')],
            })
            .mockResolvedValueOnce({ status: 'idle', content: [] });
        await component.updateSelection('a', 'a');
        await component.updateSelection('b', 'b');
        expect(component.unavailable()).toBe(true);
        expect(component.result()).toBeNull();
        catalogue.mockRejectedValueOnce(new Error('read failed'));
        await component.updateSelection('a', 'a');
        expect(component.failed()).toBe(true);
        expect(component.unavailable()).toBe(false);
    });

    it('does not let an older refresh replace the latest result', async () => {
        const seriesA = deferred<ReturnType<typeof completed>>();
        const seriesB = deferred<ReturnType<typeof completed>>();
        const liveA = deferred<ReturnType<typeof completed>>();
        const liveB = deferred<ReturnType<typeof completed>>();
        catalogue.mockImplementation((playlistId: string, type: string) => {
            const requests = {
                series: { a: seriesA, b: seriesB },
                live: { a: liveA, b: liveB },
            };
            return requests[type as 'series' | 'live']?.[
                playlistId as 'a' | 'b'
            ]?.promise;
        });
        component.playlistA.set('a');
        component.playlistB.set('b');

        const series = component.selectType('series');
        const live = component.selectType('live');
        liveA.resolve(
            completed([
                { ...content(1, 'Live A'), type: 'live', epg_channel_id: 'x' },
            ])
        );
        liveB.resolve(
            completed([
                { ...content(2, 'Live B'), type: 'live', epg_channel_id: 'x' },
            ])
        );
        await live;
        seriesA.resolve(completed([content(3, 'Series A')]));
        seriesB.resolve(completed([content(4, 'Series B')]));
        await series;

        expect(component.type()).toBe('live');
        expect(component.result()?.common[0].a[0].title).toBe('Live A');
    });

    it('uses the content type captured when the refresh began', async () => {
        const movieA = deferred<ReturnType<typeof completed>>();
        const movieB = deferred<ReturnType<typeof completed>>();
        catalogue.mockImplementation(() =>
            catalogue.mock.calls.length % 2 === 1
                ? movieA.promise
                : movieB.promise
        );
        component.playlistA.set('a');
        component.playlistB.set('b');

        const refresh = component.refresh();
        component.type.set('live');
        movieA.resolve(completed([{ ...content(1, 'Movie A'), tmdb_id: 42 }]));
        movieB.resolve(completed([{ ...content(2, 'Movie B'), tmdb_id: 42 }]));
        await refresh;

        expect(component.result()?.common).toHaveLength(1);
        expect(component.result()?.common[0].reason).toBe('tmdb');
    });
});
