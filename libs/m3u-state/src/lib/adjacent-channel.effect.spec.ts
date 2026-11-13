import { Injector, runInInjectionContext } from '@angular/core';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { Channel } from '@iptvnator/shared/interfaces';
import { BehaviorSubject, EMPTY, Subject } from 'rxjs';
import { ChannelActions } from './actions';
import { PlaylistEffects } from './effects';
import { m3uCatalogSource } from './m3u-catalog-source';
import { selectActive, selectChannels } from './selectors';

const channel = (id: string) =>
    ({ id, url: `http://h.example/${id}` }) as Channel;
const NEWS = channel('news');
const SPORT = channel('sport');
const FILM = channel('film');

/**
 * `setAdjacentChannelAsActive$` (channel up/down). Built in a plain
 * injection context, as the other effect specs of this target are.
 */
describe('PlaylistEffects setAdjacentChannelAsActive$', () => {
    let actions$: Subject<unknown>;
    let emitted: unknown[];
    const active$ = new BehaviorSubject<Channel | undefined>(undefined);
    const channels$ = new BehaviorSubject<Channel[]>([]);

    beforeEach(() => {
        actions$ = new Subject();
        emitted = [];
        m3uCatalogSource.set(null);
        channels$.next([NEWS, SPORT, FILM]);
        const injector = Injector.create({
            parent: { get: () => ({}) } as unknown as Injector,
            providers: [
                { provide: Actions, useValue: new Actions(actions$) },
                {
                    provide: Store,
                    useValue: {
                        dispatch: jest.fn(),
                        select: (selector: unknown) =>
                            selector === selectChannels
                                ? channels$
                                : selector === selectActive
                                  ? active$
                                  : EMPTY,
                    },
                },
            ],
        });
        const effects = runInInjectionContext(
            injector,
            () => new PlaylistEffects()
        );
        effects.setAdjacentChannelAsActive$.subscribe((action) =>
            emitted.push(action)
        );
    });

    afterEach(() => m3uCatalogSource.set(null));

    function step(direction: 'next' | 'previous', from: Channel): unknown {
        active$.next(from);
        actions$.next(ChannelActions.setAdjacentChannelAsActive({ direction }));
        return emitted.at(-1);
    }

    it('steps through the stored rows until an M3U route creates the catalog', () => {
        expect(step('next', NEWS)).toEqual(
            ChannelActions.setActiveChannelSuccess({ channel: SPORT })
        );
        expect(step('previous', SPORT)).toEqual(
            ChannelActions.setActiveChannelSuccess({ channel: NEWS })
        );
        expect(step('next', SPORT)).toEqual(
            ChannelActions.setActiveChannelSuccess({ channel: FILM })
        );
    });

    it('starts from the first stored row when nothing is active yet', () => {
        active$.next(undefined);
        actions$.next(
            ChannelActions.setAdjacentChannelAsActive({ direction: 'next' })
        );

        expect(emitted.at(-1)).toEqual(
            ChannelActions.setActiveChannelSuccess({ channel: NEWS })
        );
    });

    it('asks the catalog once it exists, so zapping stays in the visible list', () => {
        const adjacentChannel = jest.fn(() => NEWS);
        m3uCatalogSource.set({ sectionsOf: () => null, adjacentChannel });

        expect(step('next', SPORT)).toEqual(
            ChannelActions.setActiveChannelSuccess({ channel: NEWS })
        );
        expect(adjacentChannel).toHaveBeenCalledWith('next', SPORT, [
            NEWS,
            SPORT,
            FILM,
        ]);
    });
});
