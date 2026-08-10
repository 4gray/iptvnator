import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import type { PlaylistMetaUpdate } from '@iptvnator/shared/interfaces';
import { EMPTY, of, Subject } from 'rxjs';
import { PlaylistActions } from './actions';
import { PlaylistEffects } from './effects';

describe('PlaylistEffects updatePlaylistMeta$', () => {
    const playlist = {
        _id: 'stalker-1',
        title: 'Portal',
        count: 0,
        importDate: '',
        portalUrl: 'https://portal.example.com/server/load.php',
    } as PlaylistMetaUpdate;

    let actions$: Subject<unknown>;
    let updatePlaylistMeta: jest.Mock;
    let effects: PlaylistEffects;

    beforeEach(() => {
        actions$ = new Subject();
        updatePlaylistMeta = jest.fn(() => of(undefined));
        const permissiveParent = {
            get: () => ({}),
        } as unknown as Injector;
        const injector = Injector.create({
            parent: permissiveParent,
            providers: [
                { provide: Actions, useValue: new Actions(actions$) },
                { provide: Store, useValue: { select: () => EMPTY } },
                {
                    provide: PlaylistsService,
                    useValue: { updatePlaylistMeta },
                },
                { provide: EpgService, useValue: { fetchEpg: jest.fn() } },
                { provide: Router, useValue: {} },
                {
                    provide: SettingsStore,
                    useValue: { getSettings: () => ({ epgUrl: [] }) },
                },
            ],
        });

        effects = runInInjectionContext(injector, () => new PlaylistEffects());
        effects.updatePlaylistMeta$.subscribe();
    });

    it('skips persistence when an awaited owner already saved the update', () => {
        actions$.next(
            PlaylistActions.updatePlaylistMeta({
                playlist,
                persist: false,
            })
        );

        expect(updatePlaylistMeta).not.toHaveBeenCalled();
    });

    it('persists ordinary metadata updates', () => {
        actions$.next(PlaylistActions.updatePlaylistMeta({ playlist }));

        expect(updatePlaylistMeta).toHaveBeenCalledWith(playlist);
    });
});
