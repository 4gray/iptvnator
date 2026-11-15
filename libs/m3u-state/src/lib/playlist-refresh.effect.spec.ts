import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { EMPTY, of, Subject } from 'rxjs';
import { PlaylistActions } from './actions';
import { PlaylistEffects } from './effects';

describe('accepted refresh publication', () => {
    it.each(['single', 'batch', 'already saved'] as const)(
        'publishes persisted %s channels instead of a superseded download',
        (mode) => {
            const accepted = {
                _id: 'shared',
                title: 'Accepted',
                url: 'https://new.test/list',
                playlist: { items: [{ id: 'new' }] },
            } as Playlist;
            const downloaded = {
                ...accepted,
                url: 'https://old.test/list',
                playlist: { items: [{ id: 'old' }] },
            } as Playlist;
            const actions = new Subject<unknown>();
            const dispatch = jest.fn();
            const updatePlaylist = jest.fn(() => of(accepted));
            const injector = Injector.create({
                parent: { get: () => ({}) } as unknown as Injector,
                providers: [
                    { provide: Actions, useValue: new Actions(actions) },
                    {
                        provide: Store,
                        useValue: { select: () => EMPTY, dispatch },
                    },
                    {
                        provide: PlaylistsService,
                        useValue: {
                            updatePlaylist,
                            updateManyPlaylists: () => of([accepted]),
                        },
                    },
                    { provide: EpgService, useValue: { fetchEpg: jest.fn() } },
                    { provide: Router, useValue: {} },
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
            const subscription =
                mode === 'batch'
                    ? effects.updateManyPlaylists$.subscribe()
                    : effects.updatePlaylist$.subscribe();
            if (mode === 'batch') {
                actions.next(
                    PlaylistActions.updateManyPlaylists({
                        playlists: [downloaded],
                    })
                );
            } else {
                actions.next(
                    PlaylistActions.updatePlaylist({
                        playlistId: accepted._id,
                        playlist:
                            mode === 'already saved' ? accepted : downloaded,
                        persist: mode !== 'already saved',
                    })
                );
            }
            if (mode === 'already saved') {
                expect(updatePlaylist).not.toHaveBeenCalled();
            }
            expect(dispatch).toHaveBeenCalledWith(
                PlaylistActions.hydrateSharedPlaylist({
                    playlistId: accepted._id,
                    playlist: accepted,
                })
            );
            subscription.unsubscribe();
            injector.destroy();
        }
    );
});
