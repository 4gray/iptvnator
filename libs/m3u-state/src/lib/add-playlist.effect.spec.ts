import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { EMPTY, Subject } from 'rxjs';
import { PlaylistActions } from './actions';
import { PlaylistEffects } from './effects';

/**
 * `addPlaylist$` persists a playlist and then fetches its EPG and navigates to
 * it. Each action carries a different playlist, so a newer add must never
 * cancel an older one's write — which is exactly what the effect's original
 * `switchMap` did as soon as two playlists were added in quick succession
 * (the OS handing over several files at once).
 *
 * Package sub-path exports (`@angular/core/testing`, `@angular/material/*`)
 * do not resolve in this Jest target — the constraint the `libs/services`
 * specs already document. So there is no TestBed here: the effect is built in
 * a plain injection context, and the collaborators `addPlaylist$` never
 * touches resolve to empty stubs through a permissive parent injector rather
 * than being imported.
 */
describe('PlaylistEffects addPlaylist$', () => {
    let actions$: Subject<unknown>;
    let effects: PlaylistEffects;
    let writes: Map<string, Subject<Playlist>>;
    let navigated: string[];

    const playlist = (id: string): Playlist =>
        ({
            _id: id,
            title: id,
            filename: id,
            playlist: { items: [] },
            favorites: [],
        }) as unknown as Playlist;

    function startWrite(id: string): Subject<Playlist> {
        const subject = new Subject<Playlist>();
        writes.set(id, subject);
        return subject;
    }

    function createEffects(): PlaylistEffects {
        // Anything `addPlaylist$` does not reach (snack bar, storage, store,
        // translations) resolves to an empty object rather than throwing.
        const permissiveParent = {
            get: () => ({}),
        } as unknown as Injector;

        const injector = Injector.create({
            parent: permissiveParent,
            providers: [
                { provide: Actions, useValue: new Actions(actions$) },
                // Sibling effects read the store while their fields
                // initialise, so this one needs a real observable.
                {
                    provide: Store,
                    useValue: { dispatch: jest.fn(), select: () => EMPTY },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        addPlaylist: (target: Playlist) =>
                            writes.get(target._id),
                    },
                },
                { provide: EpgService, useValue: { fetchEpg: jest.fn() } },
                {
                    provide: Router,
                    useValue: {
                        navigate: (commands: unknown[]) => {
                            navigated.push(String(commands.at(-1)));
                            return Promise.resolve(true);
                        },
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: { getSettings: () => ({ epgUrl: [] }) },
                },
            ],
        });

        return runInInjectionContext(injector, () => new PlaylistEffects());
    }

    beforeEach(() => {
        actions$ = new Subject();
        writes = new Map();
        navigated = [];
        effects = createEffects();
        effects.addPlaylist$.subscribe();
    });

    it('navigates to a playlist once its write completes', () => {
        const write = startWrite('solo');

        actions$.next(
            PlaylistActions.addPlaylist({ playlist: playlist('solo') })
        );
        write.next(playlist('solo'));
        write.complete();

        expect(navigated).toEqual(['solo']);
    });

    // The regression: under switchMap the second action unsubscribed the
    // first write, so 'first' never reached its navigation/EPG side effects.
    it('completes an in-flight add before starting the next one', () => {
        const firstWrite = startWrite('first');
        const secondWrite = startWrite('second');

        actions$.next(
            PlaylistActions.addPlaylist({ playlist: playlist('first') })
        );
        actions$.next(
            PlaylistActions.addPlaylist({ playlist: playlist('second') })
        );

        // The second add must not have started while the first is pending.
        expect(secondWrite.observed).toBe(false);

        firstWrite.next(playlist('first'));
        firstWrite.complete();

        expect(navigated).toEqual(['first']);
        expect(secondWrite.observed).toBe(true);

        secondWrite.next(playlist('second'));
        secondWrite.complete();

        expect(navigated).toEqual(['first', 'second']);
    });

    it('skips temporary playlists without touching storage', () => {
        const write = startWrite('temp');

        actions$.next(
            PlaylistActions.handleAddingPlaylistByUrl({
                playlist: playlist('temp'),
                isTemporary: true,
            })
        );

        expect(write.observed).toBe(false);
        expect(navigated).toEqual([]);
    });
});
