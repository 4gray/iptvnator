import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import {
    PlaylistMeta,
    XTREAM_CONTENT_TYPES,
} from '@iptvnator/shared/interfaces';
import {
    credentials,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

const source = { _id: 'p', xtreamContentTypes: ['live'] } as PlaylistMeta;

describe('Electron catalog selection metadata reads', () => {
    it('uses reactive source metadata for all catalog checks without extra playlist IPC', async () => {
        TestBed.configureTestingModule({ providers: [provideMockStore()] });
        const { dataSource, dbService } = setupElectronXtreamDataSource();
        const store = TestBed.inject(MockStore);
        const selection = store.overrideSelector(selectAllPlaylistsMeta, [
            source,
        ]);
        store.refreshState();

        for (const type of XTREAM_CONTENT_TYPES) {
            const categoryType = type === 'movie' ? 'movies' : type;
            await dataSource.hasCategories('p', categoryType);
            await dataSource.hasContent('p', type);
            await dataSource.getCategories(
                'p',
                credentials,
                type === 'movie' ? 'vod' : type
            );
            await dataSource.getContent('p', credentials, type);
            await dataSource.getCachedCategories(
                'p',
                type === 'movie' ? 'vod' : type
            );
            await dataSource.getCachedContent('p', type);
        }
        await dataSource.searchContent('p', 'query', ['live', 'movie']);
        expect(dbService.searchXtreamContent).toHaveBeenLastCalledWith(
            'p',
            'query',
            ['live'],
            undefined
        );
        expect(dbService.getPlaylistById).not.toHaveBeenCalled();

        selection.setResult([{ ...source, xtreamContentTypes: [] }]);
        store.refreshState();
        dbService.getXtreamContent.mockClear();
        expect(await dataSource.getCachedContent('p', 'live')).toEqual([]);
        expect(dbService.getXtreamContent).not.toHaveBeenCalled();
        expect(dbService.getPlaylistById).not.toHaveBeenCalled();
    });

    it('falls back to SQLite when the requested source is absent from metadata', async () => {
        TestBed.configureTestingModule({
            providers: [
                provideMockStore({
                    selectors: [
                        { selector: selectAllPlaylistsMeta, value: [source] },
                    ],
                }),
            ],
        });
        const { dataSource, dbService } = setupElectronXtreamDataSource();
        dbService.getPlaylistById.mockResolvedValue({
            id: 'other',
            xtreamContentTypes: [],
        });
        expect(await dataSource.getCachedContent('other', 'live')).toEqual([]);
        expect(dbService.getPlaylistById).toHaveBeenCalledWith('other');
        expect(dbService.getXtreamContent).not.toHaveBeenCalled();
    });
});
