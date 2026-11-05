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
    let fetchEpg: jest.Mock;
    let effects: PlaylistEffects;

    beforeEach(() => {
        actions$ = new Subject();
        updatePlaylistMeta = jest.fn(() => of(undefined));
        fetchEpg = jest.fn();
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
                { provide: EpgService, useValue: { fetchEpg } },
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

    it('fetches already-persisted M3U EPG changes without repeating persistence or duplicate fetches', () => {
        const guide = 'https://guide.example.test/saved.xml';
        const saved = {
            ...playlist,
            _id: 'm3u',
            portalUrl: undefined,
            epgUrls: [guide],
            manualEpgUrls: [guide],
        };
        actions$.next(
            PlaylistActions.updatePlaylistMeta({
                playlist: saved,
                persist: false,
            })
        );
        expect(updatePlaylistMeta).not.toHaveBeenCalled();
        expect(fetchEpg).toHaveBeenCalledWith([guide]);
        actions$.next(
            PlaylistActions.updatePlaylistMeta({
                playlist: saved,
                persist: false,
            })
        );
        expect(fetchEpg).toHaveBeenCalledTimes(1);
    });

    it('does not cancel an older write when an awaited owner publishes saved metadata', () => {
        const write = new Subject<undefined>();
        updatePlaylistMeta.mockReturnValue(write);
        const first = {
            ...playlist,
            _id: 'first-m3u',
            portalUrl: undefined,
            epgUrls: ['https://guide.example.test/first.xml'],
        };
        const saved = {
            ...first,
            _id: 'saved-m3u',
            epgUrls: ['https://guide.example.test/saved.xml'],
        };
        actions$.next(PlaylistActions.updatePlaylistMeta({ playlist: first }));
        actions$.next(
            PlaylistActions.updatePlaylistMeta({
                playlist: saved,
                persist: false,
            })
        );
        write.next(undefined);
        write.complete();
        expect(updatePlaylistMeta).toHaveBeenCalledTimes(1);
        expect(fetchEpg).toHaveBeenCalledWith(first.epgUrls);
        expect(fetchEpg).toHaveBeenCalledWith(saved.epgUrls);
    });
});
