import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerContentType } from '../stalker-store.contracts';
import { withStalkerRecent } from './with-stalker-recent.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    ...jest.requireActual('@iptvnator/portal/shared/util'),
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const PLAYLIST = {
    _id: 'portal-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-04-14T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
} as PlaylistMeta;

const TestRecentStore = signalStore(
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
    withStalkerRecent()
);

describe('withStalkerRecent', () => {
    let store: InstanceType<typeof TestRecentStore>;
    let playlistService: {
        addPortalRecentlyViewed: jest.Mock;
        removeFromPortalRecentlyViewed: jest.Mock;
    };
    let ngrxStore: { dispatch: jest.Mock };

    beforeEach(() => {
        playlistService = {
            addPortalRecentlyViewed: jest.fn(() =>
                of({ recentlyViewed: [{ id: '22', title: 'Movie Title' }] })
            ),
            removeFromPortalRecentlyViewed: jest.fn(() =>
                of({ recentlyViewed: [] })
            ),
        };
        ngrxStore = { dispatch: jest.fn() };

        TestBed.configureTestingModule({
            providers: [
                TestRecentStore,
                { provide: PlaylistsService, useValue: playlistService },
                { provide: Store, useValue: ngrxStore },
            ],
        });

        store = TestBed.inject(TestRecentStore);
    });

    describe('addToRecentlyViewed', () => {
        it('persists a normalized recent item and syncs playlist meta', () => {
            store.addToRecentlyViewed({
                id: ' 22 ',
                name: 'Movie Title',
                category_id: '',
            });

            expect(
                playlistService.addPortalRecentlyViewed
            ).toHaveBeenCalledWith(
                'portal-1',
                expect.objectContaining({
                    id: '22',
                    title: 'Movie Title',
                    category_id: 'vod',
                    added_at: expect.any(Number),
                })
            );
            expect(ngrxStore.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: 'portal-1',
                        recentlyViewed: [{ id: '22', title: 'Movie Title' }],
                    } as PlaylistMeta,
                })
            );
        });

        it('forces the series category and falls back to stream_id and o_name', () => {
            store.setSelectedContentType('series');

            store.addToRecentlyViewed({
                stream_id: 30000,
                o_name: 'Original Series Name',
                category_id: '99',
            });

            expect(
                playlistService.addPortalRecentlyViewed
            ).toHaveBeenCalledWith(
                'portal-1',
                expect.objectContaining({
                    id: '30000',
                    title: 'Original Series Name',
                    category_id: 'series',
                })
            );
        });

        it('keeps a provided category id for non-series content', () => {
            store.setSelectedContentType('itv');

            store.addToRecentlyViewed({
                id: '5',
                title: 'Channel Five',
                category_id: '4001',
            });

            expect(
                playlistService.addPortalRecentlyViewed
            ).toHaveBeenCalledWith(
                'portal-1',
                expect.objectContaining({
                    id: '5',
                    title: 'Channel Five',
                    category_id: '4001',
                })
            );
        });

        it('does nothing when no portal playlist is active', () => {
            store.setCurrentPlaylist(undefined);

            store.addToRecentlyViewed({ id: '22', title: 'Movie Title' });

            expect(
                playlistService.addPortalRecentlyViewed
            ).not.toHaveBeenCalled();
            expect(ngrxStore.dispatch).not.toHaveBeenCalled();
        });
    });

    describe('removeFromRecentlyViewed', () => {
        it('removes the item, syncs playlist meta, and signals completion', () => {
            const onComplete = jest.fn();

            store.removeFromRecentlyViewed('22', onComplete);

            expect(
                playlistService.removeFromPortalRecentlyViewed
            ).toHaveBeenCalledWith('portal-1', '22');
            expect(ngrxStore.dispatch).toHaveBeenCalledWith(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: 'portal-1',
                        recentlyViewed: [],
                    } as PlaylistMeta,
                })
            );
            expect(onComplete).toHaveBeenCalled();
        });

        it('swallows removal errors without syncing meta or completing', () => {
            const onComplete = jest.fn();
            playlistService.removeFromPortalRecentlyViewed.mockReturnValue(
                throwError(() => new Error('portal unreachable'))
            );

            expect(() =>
                store.removeFromRecentlyViewed('22', onComplete)
            ).not.toThrow();

            expect(ngrxStore.dispatch).not.toHaveBeenCalled();
            expect(onComplete).not.toHaveBeenCalled();
        });

        it('does nothing when no portal playlist is active', () => {
            const onComplete = jest.fn();
            store.setCurrentPlaylist(undefined);

            store.removeFromRecentlyViewed('22', onComplete);

            expect(
                playlistService.removeFromPortalRecentlyViewed
            ).not.toHaveBeenCalled();
            expect(onComplete).not.toHaveBeenCalled();
        });
    });
});
