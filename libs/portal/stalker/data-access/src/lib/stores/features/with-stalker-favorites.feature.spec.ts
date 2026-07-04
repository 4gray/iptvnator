import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerContentType } from '../stalker-store.contracts';
import { withStalkerFavorites } from './with-stalker-favorites.feature';

const PLAYLIST = {
    _id: 'portal-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-04-14T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
} as PlaylistMeta;

const TestFavoritesStore = signalStore(
    withState<{
        currentPlaylist: PlaylistMeta | undefined;
        selectedContentType: StalkerContentType;
    }>({
        currentPlaylist: PLAYLIST,
        selectedContentType: 'vod',
    }),
    withMethods((store) => ({
        setCurrentPlaylist(playlist: PlaylistMeta | undefined) {
            patchState(store, { currentPlaylist: playlist });
        },
        setSelectedContentType(type: StalkerContentType) {
            patchState(store, { selectedContentType: type });
        },
    })),
    withStalkerFavorites()
);

describe('withStalkerFavorites', () => {
    let store: InstanceType<typeof TestFavoritesStore>;
    let playlistService: {
        addPortalFavorite: jest.Mock;
        removeFromPortalFavorites: jest.Mock;
    };
    let snackBar: { open: jest.Mock };
    let ngrxStore: { dispatch: jest.Mock };

    beforeEach(() => {
        playlistService = {
            addPortalFavorite: jest.fn(() =>
                of({ favorites: [{ id: '42', title: 'Movie Title' }] })
            ),
            removeFromPortalFavorites: jest.fn(() =>
                of({ favorites: [] })
            ),
        };
        snackBar = { open: jest.fn() };
        ngrxStore = { dispatch: jest.fn() };

        TestBed.configureTestingModule({
            providers: [
                TestFavoritesStore,
                { provide: PlaylistsService, useValue: playlistService },
                { provide: MatSnackBar, useValue: snackBar },
                {
                    provide: TranslateService,
                    useValue: { instant: jest.fn((key: string) => key) },
                },
                { provide: Store, useValue: ngrxStore },
            ],
        });

        store = TestBed.inject(TestFavoritesStore);
    });

    describe('addToFavorites', () => {
        it('persists the favorite with a normalized payload and syncs playlist meta', () => {
            const onDone = jest.fn();

            store.addToFavorites(
                {
                    stream_id: 42,
                    id: 'ignored-id',
                    name: 'Movie Title',
                    category_id: '17',
                },
                onDone
            );

            expect(playlistService.addPortalFavorite).toHaveBeenCalledWith(
                'portal-1',
                expect.objectContaining({
                    id: 42,
                    name: 'Movie Title',
                    category_id: '17',
                    added_at: expect.any(Number),
                })
            );
            expect(ngrxStore.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: 'portal-1',
                        favorites: [{ id: '42', title: 'Movie Title' }],
                    } as PlaylistMeta,
                })
            );
            expect(snackBar.open).toHaveBeenCalledWith(
                'PORTALS.ADDED_TO_FAVORITES',
                undefined,
                { duration: 1000 }
            );
            expect(onDone).toHaveBeenCalled();
        });

        it('falls back to the selected content type when the category id is blank', () => {
            store.setSelectedContentType('itv');

            store.addToFavorites({ id: '9', category_id: '  ' });

            expect(playlistService.addPortalFavorite).toHaveBeenCalledWith(
                'portal-1',
                expect.objectContaining({
                    id: '9',
                    category_id: 'itv',
                })
            );
        });

        it('falls back to the item id when no stream id is present', () => {
            store.addToFavorites({ id: '77', name: 'Channel' });

            expect(playlistService.addPortalFavorite).toHaveBeenCalledWith(
                'portal-1',
                expect.objectContaining({ id: '77' })
            );
        });

        it('does nothing when no portal playlist is active', () => {
            const onDone = jest.fn();
            store.setCurrentPlaylist(undefined);

            store.addToFavorites({ id: '9' }, onDone);

            expect(playlistService.addPortalFavorite).not.toHaveBeenCalled();
            expect(ngrxStore.dispatch).not.toHaveBeenCalled();
            expect(snackBar.open).not.toHaveBeenCalled();
            expect(onDone).not.toHaveBeenCalled();
        });
    });

    describe('removeFromFavorites', () => {
        it('removes the favorite and syncs the emptied playlist meta', () => {
            const onDone = jest.fn();

            store.removeFromFavorites('42', onDone);

            expect(
                playlistService.removeFromPortalFavorites
            ).toHaveBeenCalledWith('portal-1', '42');
            expect(ngrxStore.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: 'portal-1',
                        favorites: [],
                    } as PlaylistMeta,
                })
            );
            expect(snackBar.open).toHaveBeenCalledWith(
                'PORTALS.REMOVED_FROM_FAVORITES',
                undefined,
                { duration: 1000 }
            );
            expect(onDone).toHaveBeenCalled();
        });

        it('does nothing when no portal playlist is active', () => {
            const onDone = jest.fn();
            store.setCurrentPlaylist(undefined);

            store.removeFromFavorites('42', onDone);

            expect(
                playlistService.removeFromPortalFavorites
            ).not.toHaveBeenCalled();
            expect(ngrxStore.dispatch).not.toHaveBeenCalled();
            expect(onDone).not.toHaveBeenCalled();
        });
    });
});
