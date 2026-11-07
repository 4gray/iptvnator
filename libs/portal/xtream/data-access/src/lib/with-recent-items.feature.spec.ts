import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    CONNECTION_KEY,
    prepareSourceConnection,
} from '@iptvnator/services/source-sync/connection';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';
import { withRecentItems } from './with-recent-items';

const TestRecentItemsStore = signalStore(withRecentItems());

describe('withRecentItems', () => {
    const originalElectron = window.electron;
    const runtime = { supportsXtreamSqliteDataSource: false };
    let store: InstanceType<typeof TestRecentItemsStore>;
    let dataSource: {
        addRecentItem: jest.Mock;
        supportsPortableHistory: jest.Mock;
        clearRecentItems: jest.Mock;
        getContentByXtreamId: jest.Mock;
        getRecentItems: jest.Mock;
        removeRecentItem: jest.Mock;
        setContentMetadataIfMissing: jest.Mock;
    };

    beforeEach(() => {
        runtime.supportsXtreamSqliteDataSource = false;
        Object.defineProperty(window, 'electron', {
            value: {} as Window['electron'],
            configurable: true,
        });

        dataSource = {
            addRecentItem: jest.fn().mockResolvedValue(undefined),
            supportsPortableHistory: jest.fn().mockResolvedValue(false),
            clearRecentItems: jest.fn().mockResolvedValue(undefined),
            getContentByXtreamId: jest.fn(),
            getRecentItems: jest.fn().mockResolvedValue([
                {
                    id: 3941697,
                    title: 'Krypton',
                    type: 'series',
                    poster_url: 'https://example.com/krypton.png',
                    backdrop_url: 'https://example.com/krypton-backdrop.png',
                    viewed_at: '2026-04-21T20:42:27.000Z',
                    xtream_id: 290,
                    category_id: 17,
                },
            ]),
            removeRecentItem: jest.fn().mockResolvedValue(undefined),
            setContentMetadataIfMissing: jest.fn().mockResolvedValue(undefined),
        };
        TestBed.configureTestingModule({
            providers: [
                TestRecentItemsStore,
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: dataSource,
                },
            ],
        });

        store = TestBed.inject(TestRecentItemsStore);
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: originalElectron,
        });
    });

    it('refreshes the loaded source after history changes and detaches on destroy', async () => {
        dataSource.getRecentItems.mockResolvedValue([]);
        store.loadRecentItems({ id: 'synthetic-source' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(store.recentItems()).toEqual([]);
        dataSource.getRecentItems.mockResolvedValue([
            {
                id: null,
                xtream_id: 42,
                type: 'series',
                title: 'Synthetic shared series',
                poster_url: '',
                category_id: '',
            },
        ]);
        window.dispatchEvent(new Event('iptvnator-history-changed'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(store.recentItems()).toEqual([
            expect.objectContaining({ xtream_id: 42, type: 'series' }),
        ]);
        dataSource.getRecentItems.mockResolvedValue([]);
        window.dispatchEvent(new Event('iptvnator-history-changed'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(store.recentItems()).toEqual([]);
        const calls = dataSource.getRecentItems.mock.calls.length;
        TestBed.resetTestingModule();
        window.dispatchEvent(new Event('iptvnator-history-changed'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(dataSource.getRecentItems).toHaveBeenCalledTimes(calls);
    });

    it('discards a delayed history reload and stops refreshing a replaced source', async () => {
        const connection = localStorage.getItem(CONNECTION_KEY);
        const key =
            'iptvnator-server:synthetic-instance:history-source-epoch:synthetic-source';
        const epoch = localStorage.getItem(key);
        try {
            localStorage.setItem(
                CONNECTION_KEY,
                JSON.stringify({
                    apiUrl: 'https://history.example/api',
                    instanceId: 'synthetic-instance',
                })
            );
            await prepareSourceConnection();
            let complete!: (items: unknown[]) => void;
            let start!: () => void;
            const started = new Promise<void>((resolve) => {
                start = resolve;
            });
            dataSource.getRecentItems.mockImplementation(() => {
                start();
                return new Promise((resolve) => {
                    complete = resolve;
                });
            });
            store.loadRecentItems({ id: 'synthetic-source' });
            await started;
            localStorage.setItem(key, 'replacement');
            complete([
                {
                    id: 42,
                    xtream_id: 42,
                    type: 'series',
                    title: 'Synthetic retired series',
                },
            ]);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(store.recentItems()).toEqual([]);
            const calls = dataSource.getRecentItems.mock.calls.length;
            window.dispatchEvent(new Event('iptvnator-history-changed'));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(dataSource.getRecentItems).toHaveBeenCalledTimes(calls);
            dataSource.getContentByXtreamId.mockImplementation(async () => {
                localStorage.setItem(key, 'retired-during-metadata-lookup');
                return { id: 42 };
            });
            await store.backfillContentMetadata({
                xtreamId: 42,
                contentType: 'series',
                playlist: signal({ id: 'synthetic-source' }),
                patch: { tmdbId: 100 },
            });
            expect(
                dataSource.setContentMetadataIfMissing
            ).not.toHaveBeenCalled();
        } finally {
            if (connection == null) localStorage.removeItem(CONNECTION_KEY);
            else localStorage.setItem(CONNECTION_KEY, connection);
            if (epoch == null) localStorage.removeItem(key);
            else localStorage.setItem(key, epoch);
            await prepareSourceConnection();
        }
    });

    it('keeps a missing native row ID separate from the display key', async () => {
        dataSource.getRecentItems.mockResolvedValue([
            {
                id: null,
                xtream_id: 42,
                type: 'live',
                title: 'Synthetic received channel',
                poster_url: '',
                category_id: '',
                viewed_at: '2026-11-06T12:00:00Z',
            },
        ]);
        store.loadRecentItems({ id: 'synthetic-source' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(store.recentItems()[0]).toMatchObject({
            id: 'recent:live:42',
            content_id: null,
            xtream_id: 42,
        });
    });

    it.each([false, true])(
        'records a provider-only native start only for a verified portable source (%s)',
        async (portable) => {
            runtime.supportsXtreamSqliteDataSource = true;
            dataSource.getContentByXtreamId.mockResolvedValue(null);
            dataSource.supportsPortableHistory.mockResolvedValue(portable);
            store.addRecentItem({
                xtreamId: 42,
                contentType: 'movie',
                playlist: signal({ id: 'synthetic-source' }),
                playedContent: { title: 'Synthetic movie' },
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(dataSource.addRecentItem).toHaveBeenCalledTimes(
                portable ? 1 : 0
            );
            if (portable)
                expect(dataSource.addRecentItem).toHaveBeenCalledWith(
                    { id: 42, type: 'movie', providerId: 42 },
                    'synthetic-source',
                    undefined,
                    { title: 'Synthetic movie' }
                );
        }
    );
    it('records the played SQLite duplicate using its displayed identity', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        dataSource.getContentByXtreamId.mockImplementation(
            async (_id, _playlist, _type, identity) => ({
                id: identity?.tmdbId === 100 ? 2 : 1,
            })
        );
        const playedContent = {
            title: 'Displayed original',
            tmdbId: 100,
            releaseYear: 1995,
        };
        store.addRecentItem({
            xtreamId: 42,
            contentType: 'movie',
            playlist: signal({ id: 'p' }),
            playedContent,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            42,
            'p',
            'movie',
            { tmdbId: 100, releaseYear: 1995 }
        );
        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            { id: 2, type: 'movie', providerId: 42 },
            'p',
            undefined,
            playedContent
        );
    });

    it('looks recent items up with the requested content type before saving one', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        store.addRecentItem({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            { id: 3941697, type: 'series', providerId: 290 },
            'playlist-1',
            undefined
        );
        expect(store.recentItems()).toEqual([
            expect.objectContaining({
                id: 3941697,
                title: 'Krypton',
                type: 'series',
                xtream_id: 290,
                backdrop_url: 'https://example.com/krypton-backdrop.png',
            }),
        ]);
    });

    it('uses the Xtream ID as the PWA recent key when cached content is cold', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        store.addRecentItem({
            xtreamId: 1767451,
            contentType: 'movie',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            { id: 1767451, type: 'movie', providerId: 1767451 },
            'playlist-1',
            undefined
        );
    });

    it('normalizes route-param Xtream IDs before using the PWA recent fallback', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        store.addRecentItem({
            xtreamId: '1767451',
            contentType: 'movie',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            1767451,
            'playlist-1',
            'movie'
        );
        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            { id: 1767451, type: 'movie', providerId: 1767451 },
            'playlist-1',
            undefined
        );
    });

    it('forwards backdrop urls on recent-item saves', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        store.addRecentItem({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
            backdropUrl: 'https://example.com/krypton-backdrop.png',
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            { id: 3941697, type: 'series', providerId: 290 },
            'playlist-1',
            'https://example.com/krypton-backdrop.png'
        );
    });

    it('backfills a cold PWA Recent item by typed provider identity', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        await store.backfillContentMetadata({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
            patch: { tmdbId: 200 },
        });
        expect(dataSource.setContentMetadataIfMissing).toHaveBeenCalledWith(
            { id: 290, type: 'series' },
            'playlist-1',
            { tmdbId: 200 }
        );
    });

    it('backfills the displayed native duplicate rather than the first provider-ID row', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        dataSource.getContentByXtreamId.mockImplementation(
            async (_id, _playlist, _type, identity) => ({
                id: identity?.tmdbId === 100 ? 2 : 1,
            })
        );
        await store.backfillContentMetadata({
            xtreamId: 42,
            contentType: 'movie',
            playlist: signal({ id: 'p1' }),
            patch: { tmdbId: 100, releaseYear: 1995 },
        });
        expect(dataSource.setContentMetadataIfMissing).toHaveBeenCalledWith(
            { id: 2, type: 'movie' },
            'p1',
            { tmdbId: 100, releaseYear: 1995 }
        );
    });

    it('backfills a backdrop without rewriting recent ordering', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        await store.backfillContentMetadata({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
            patch: {
                backdropUrl: ' https://example.com/krypton-backdrop.png ',
            },
        });

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(dataSource.setContentMetadataIfMissing).toHaveBeenCalledWith(
            { id: 3941697, type: 'series' },
            'playlist-1',
            { backdropUrl: 'https://example.com/krypton-backdrop.png' }
        );
        expect(dataSource.addRecentItem).not.toHaveBeenCalled();
    });

    it('clears recent items through the active data source in PWA', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });

        store.clearRecentItems({ id: 'playlist-1' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.clearRecentItems).toHaveBeenCalledWith('playlist-1');
        expect(store.recentItems()).toEqual([]);
    });

    it('removes recent items through the active data source in PWA', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });

        store.removeRecentItem({
            itemId: 3941697,
            contentType: 'series',
            playlistId: 'playlist-1',
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.removeRecentItem).toHaveBeenCalledWith(
            { id: 3941697, type: 'series' },
            'playlist-1'
        );
        expect(store.recentItems()).toEqual([
            expect.objectContaining({
                id: 3941697,
                title: 'Krypton',
            }),
        ]);
    });

    it('removes recent items through the active data source in Electron mode', async () => {
        store.removeRecentItem({ itemId: 3941697, playlistId: 'playlist-1' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.removeRecentItem).toHaveBeenCalledWith(
            3941697,
            'playlist-1'
        );
        expect(store.recentItems()).toEqual([
            expect.objectContaining({
                id: 3941697,
                title: 'Krypton',
            }),
        ]);
    });
    it('forwards played metadata even when a cold PWA lookup has no row', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        const playedContent = {
            title: 'Replacement',
            tmdbId: 200,
            posterUrl: 'replacement.jpg',
        };
        store.addRecentItem({
            xtreamId: 42,
            contentType: 'movie',
            playlist: signal({ id: 'playlist-1' }),
            playedContent,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            { id: 42, type: 'movie', providerId: 42 },
            'playlist-1',
            undefined,
            playedContent
        );
    });
});
