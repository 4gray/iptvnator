import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { BehaviorSubject } from 'rxjs';
import { M3uCatalogIndexService } from '@iptvnator/m3u-state';
import { SettingsStore } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import {
    buildM3uCatalogIndex,
    buildM3uSeriesCatalog,
} from '@iptvnator/shared/m3u-utils';
import type { M3uCatalogRouteComponent as M3uCatalogRouteComponentType } from './m3u-catalog-route.component';

// The shared portal-UI barrel reaches video.js (unified collection ->
// ui/playback -> Video.js); its CJS bundle cannot be evaluated under the ESM
// jest environment, so it is mocked before the dynamic import below pulls
// the chain in.
jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

const channel = (url: string, name: string, group: string) =>
    ({ url, name, group: { title: group }, tvg: {} }) as unknown as Channel;

const DUNE = channel('http://h.example/movie/u/p/1.mkv', 'Dune', 'Films');
const MATRIX = channel(
    'http://h.example/movie/u/p/2.mkv',
    'Matrix',
    'Classics'
);
const EPISODE = channel(
    'http://h.example/series/u/p/3.mp4',
    'Dark S01E01',
    'Shows'
);
const LIVE = channel('http://h.example/live/u/p/4.ts', 'TRT 1', 'Ulusal');

describe('M3uCatalogRouteComponent', () => {
    let M3uCatalogRouteComponent: typeof M3uCatalogRouteComponentType;

    beforeAll(async () => {
        ({ M3uCatalogRouteComponent } =
            await import('./m3u-catalog-route.component'));
    });

    const channels = signal<Channel[]>([]);
    const queryParams = new BehaviorSubject(
        new Map<string, string>() as unknown as {
            get(key: string): string | null;
        }
    );
    const dispatch = jest.fn();
    const navigate = jest.fn();

    const params = (q?: string) => ({ get: () => q ?? null });

    async function render(
        kind: 'movie' | 'episode'
    ): Promise<ComponentFixture<M3uCatalogRouteComponentType>> {
        TestBed.configureTestingModule({
            imports: [M3uCatalogRouteComponent],
            providers: [
                { provide: Store, useValue: { dispatch } },
                { provide: Router, useValue: { navigate } },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { data: { kind } },
                        queryParamMap: queryParams,
                    },
                },
                {
                    provide: M3uCatalogIndexService,
                    useValue: {
                        index: () => buildM3uCatalogIndex(channels()),
                        hasNonLiveContent: () => true,
                        series: () =>
                            buildM3uSeriesCatalog(
                                buildM3uCatalogIndex(channels()).byKind.episode,
                                'pl-1'
                            ),
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: { stripCountryPrefix: () => false },
                },
            ],
        }).overrideComponent(M3uCatalogRouteComponent, {
            add: { imports: [MockPipe(TranslatePipe, (value) => `${value}`)] },
            remove: { imports: [TranslatePipe] },
        });

        const fixture = TestBed.createComponent(M3uCatalogRouteComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        return fixture;
    }

    beforeEach(() => {
        TestBed.resetTestingModule();
        channels.set([]);
        queryParams.next(params());
        dispatch.mockReset();
        navigate.mockReset();
    });

    it('lists only the groups of its own kind', async () => {
        channels.set([DUNE, MATRIX, EPISODE, LIVE]);
        const fixture = await render('movie');
        const component = fixture.componentInstance as unknown as {
            categoryItems(): { name: string }[];
        };

        expect(component.categoryItems().map((item) => item.name)).toEqual([
            'Films',
            'Classics',
        ]);
    });

    it('selects the first group so the grid is never empty on arrival', async () => {
        channels.set([DUNE, MATRIX]);
        const fixture = await render('movie');
        const component = fixture.componentInstance as unknown as {
            selectedGroup(): string | null;
            cards(): { name: string }[];
        };

        expect(component.selectedGroup()).toBe('Films');
        expect(component.cards().map((card) => card.name)).toEqual(['Dune']);
    });

    it('searches across the whole kind rather than the selected group', async () => {
        // A viewer does not know which of a provider's groups holds the film
        // they are after, so narrowing search to the open group would make
        // it useless on exactly the playlists this feature exists for.
        channels.set([DUNE, MATRIX]);
        queryParams.next(params('matrix'));
        const fixture = await render('movie');
        const component = fixture.componentInstance as unknown as {
            selectedGroup(): string | null;
            cards(): { name: string }[];
        };

        expect(component.selectedGroup()).toBe('Films');
        expect(component.cards().map((card) => card.name)).toEqual(['Matrix']);
    });

    it('reports empty when the playlist has none of its kind', async () => {
        channels.set([LIVE]);
        const fixture = await render('movie');
        const component = fixture.componentInstance as unknown as {
            isEmpty(): boolean;
        };

        expect(component.isEmpty()).toBe(true);
    });

    it('hands an activated card to the player as navigation state', async () => {
        // Not a dispatch: the `all` route provides a fresh session that
        // reloads the playlist and resets the active channel, so anything
        // dispatched before navigating is discarded.
        channels.set([DUNE]);
        const fixture = await render('movie');
        const component = fixture.componentInstance as unknown as {
            cards(): { id: string }[];
            onCardActivated(card: { id: string }): void;
        };

        component.onCardActivated({ id: component.cards()[0].id });

        expect(dispatch).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith(
            ['../all'],
            expect.objectContaining({
                state: { openM3uChannelUrl: DUNE.url },
            })
        );
    });

    it('ignores a card whose row is no longer in the catalog', async () => {
        channels.set([DUNE]);
        const fixture = await render('movie');
        const component = fixture.componentInstance as unknown as {
            onCardActivated(card: { id: string }): void;
        };

        component.onCardActivated({ id: 'http://h.example/gone.mkv' });

        expect(dispatch).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('shows series rather than episode rows in the series section', async () => {
        // The whole point of aggregating: a viewer sees the show, not the
        // forty rows it occupies.
        channels.set([
            DUNE,
            EPISODE,
            channel(
                'http://h.example/series/u/p/5.mp4',
                'Dark S01E02',
                'Shows'
            ),
        ]);
        const fixture = await render('episode');
        const component = fixture.componentInstance as unknown as {
            cards(): { name: string; seriesId?: number }[];
        };

        expect(component.cards()).toHaveLength(1);
        expect(component.cards()[0].name).toBe('Dark');
        expect(typeof component.cards()[0].seriesId).toBe('number');
    });

    it('opens the detail route for a series card', async () => {
        channels.set([EPISODE]);
        const fixture = await render('episode');
        const component = fixture.componentInstance as unknown as {
            cards(): { seriesId?: number }[];
            onCardActivated(card: { seriesId?: number }): void;
        };
        const id = component.cards()[0].seriesId;

        component.onCardActivated({ seriesId: id });

        expect(navigate).toHaveBeenCalledWith(
            ['..', 'series', id],
            expect.objectContaining({})
        );
        expect(dispatch).not.toHaveBeenCalled();
    });
});
