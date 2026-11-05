import { Injector, runInInjectionContext } from '@angular/core';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import { of, Subject } from 'rxjs';
import { FavoritesActions } from './actions';
import { PlaylistEffects } from './effects';
import { selectActivePlaylistId, selectFavorites } from './selectors';

describe('PlaylistEffects updateFavorites$', () => {
    let actions$: Subject<unknown>;
    let transformPlaylistFavorites: jest.Mock;
    let storedFavorites: string[];

    function setup(afterToggle: string[]) {
        actions$ = new Subject();
        transformPlaylistFavorites = jest.fn(
            (_id: string, transform: (current: string[]) => string[]) => {
                storedFavorites = transform(storedFavorites);
                return of(undefined);
            }
        );
        const injector = Injector.create({
            parent: { get: () => ({}) } as unknown as Injector,
            providers: [
                { provide: Actions, useValue: new Actions(actions$) },
                {
                    provide: Store,
                    useValue: {
                        select: (selector: unknown) =>
                            of(
                                selector === selectFavorites
                                    ? afterToggle
                                    : selector === selectActivePlaylistId
                                      ? 'p1'
                                      : undefined
                            ),
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: { transformPlaylistFavorites },
                },
                { provide: EpgService, useValue: { fetchEpg: jest.fn() } },
                { provide: Router, useValue: {} },
                {
                    provide: LazySnackBar,
                    useValue: { open: jest.fn().mockResolvedValue(null) },
                },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                {
                    provide: SettingsStore,
                    useValue: { getSettings: () => ({ epgUrl: [] }) },
                },
            ],
        });
        const effects = runInInjectionContext(
            injector,
            () => new PlaylistEffects()
        );
        effects.updateFavorites$.subscribe();
        effects.setFavorites$.subscribe();
    }

    const channel = { url: 'http://a' } as Channel;

    it("adds the toggled channel to the stored favorites, keeping others'", () => {
        // This device's state did not know about 'http://b' yet.
        storedFavorites = ['http://b'];
        setup(['http://a']);

        actions$.next(FavoritesActions.updateFavorites({ channel }));

        expect(transformPlaylistFavorites).toHaveBeenCalledWith(
            'p1',
            expect.any(Function)
        );
        expect(storedFavorites).toEqual(['http://b', 'http://a']);
    });

    it('removes only the toggled channel', () => {
        storedFavorites = ['http://a', 'http://b'];
        setup([]);

        actions$.next(FavoritesActions.updateFavorites({ channel }));

        expect(storedFavorites).toEqual(['http://b']);
    });

    it('applies a reorder to the stored favorites', () => {
        // Another device added 'http://new' and removed 'http://gone'.
        storedFavorites = ['http://a', 'http://b', 'http://new'];
        setup([]);

        actions$.next(
            FavoritesActions.setFavorites({
                channelIds: ['http://b', 'http://gone', 'http://a'],
            })
        );

        expect(storedFavorites).toEqual(['http://b', 'http://a', 'http://new']);
    });
});
