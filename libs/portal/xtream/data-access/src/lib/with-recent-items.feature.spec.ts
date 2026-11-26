import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withState } from '@ngrx/signals';
import {
    RuntimeCapabilitiesService,
    SourceActivityService,
} from '@iptvnator/services';
import {
    CONNECTION_KEY,
    prepareSourceConnection,
} from '@iptvnator/services/source-sync/connection';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';
import { withRecentItems } from './with-recent-items';

const TestRecentItemsStore = signalStore(
    { protectedState: false },
    withState<{ playlistId: string | null }>({ playlistId: 'playlist-1' }),
    withRecentItems()
);

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

    it('records confirmed live playback after its catalog rows are reinserted', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        await store.prepareRecentActions();
        const activity = TestBed.inject(SourceActivityService);
        const finishReplacement = activity.begin(['synthetic-source']);
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        dataSource.getRecentItems.mockResolvedValue([]);

        const viewedAt = '2026-01-01T00:00:00.123Z';
        store.addRecentItem({
            viewedAt,
            xtreamId: 42,
            contentType: 'live',
            playlist: signal({ id: 'synthetic-source' }),
        });
        try {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(dataSource.getContentByXtreamId).not.toHaveBeenCalled();
            dataSource.getContentByXtreamId.mockResolvedValue({ id: 502 });
        } finally {
            finishReplacement();
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            { id: 502, type: 'live', providerId: 42 },
            'synthetic-source',
            undefined,
            undefined,
            viewedAt
        );
        expect(activity.isBusy('synthetic-source')).toBe(false);
    });

    it('finishes deferred playback before clearing the same SQLite source', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        const activity = TestBed.inject(SourceActivityService);
        const release = activity.begin(['playlist-1']);
        dataSource.getContentByXtreamId.mockResolvedValue({ id: 502 });
        const cleared = new Promise<void>((resolve) => {
            dataSource.clearRecentItems.mockImplementation(async () => {
                resolve();
            });
        });

        store.addRecentItem({
            xtreamId: 42,
            contentType: 'live',
            playlist: signal({ id: 'playlist-1' }),
        });
        store.clearRecentItems({ id: 'playlist-1' });
        await Promise.resolve();
        const clearedWhileHeld = dataSource.clearRecentItems.mock.calls.length;
        release();
        await cleared;

        expect(clearedWhileHeld).toBe(0);
        expect(dataSource.addRecentItem).toHaveBeenCalledTimes(1);
        expect(
            dataSource.addRecentItem.mock.invocationCallOrder[0]
        ).toBeLessThan(dataSource.clearRecentItems.mock.invocationCallOrder[0]);
    });

    it('saves the old source confirmation without replacing the new source history', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        const oldSource = 'synthetic-source-a';
        const newSource = 'synthetic-source-b';
        patchState(store, { playlistId: oldSource });
        await store.prepareRecentActions();
        const activity = TestBed.inject(SourceActivityService);
        const finishReplacement = activity.begin([oldSource]);
        const playedContent = { title: 'Synthetic live item', categoryId: 19 };
        dataSource.getContentByXtreamId.mockImplementation(
            async (_id, _playlist, _type, _identity, categoryId) => ({
                id: categoryId === playedContent.categoryId ? 502 : 200,
            })
        );
        dataSource.getRecentItems.mockImplementation(
            async (playlistId: string) =>
                playlistId === oldSource
                    ? [
                          {
                              id: 502,
                              xtream_id: 42,
                              type: 'live',
                              title: 'Synthetic live item',
                          },
                      ]
                    : [
                          {
                              id: 701,
                              xtream_id: 99,
                              type: 'series',
                              title: 'Synthetic series',
                          },
                      ]
        );

        store.addRecentItem({
            xtreamId: 42,
            contentType: 'live',
            playlist: signal({ id: oldSource }),
            playedContent,
        });
        try {
            patchState(store, { playlistId: newSource });
            store.loadRecentItems({ id: newSource });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(store.recentItems()).toEqual([
                expect.objectContaining({
                    playlist_id: newSource,
                    xtream_id: 99,
                }),
            ]);
            expect(dataSource.addRecentItem).not.toHaveBeenCalled();
        } finally {
            finishReplacement();
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            { id: 502, type: 'live', providerId: 42 },
            oldSource,
            undefined,
            playedContent
        );
        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            42,
            oldSource,
            'live',
            undefined,
            19,
            undefined,
            true
        );
        expect(store.recentItems()).toEqual([
            expect.objectContaining({ playlist_id: newSource, xtream_id: 99 }),
        ]);
    });

    it('refreshes the loaded source after history changes and detaches on destroy', async () => {
        dataSource.getRecentItems.mockResolvedValue([]);
        patchState(store, { playlistId: 'synthetic-source' });
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
            patchState(store, { playlistId: 'synthetic-source' });
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

    it('refreshes again after consent changes and discards reads from the previous consent', async () => {
        const connection = localStorage.getItem(CONNECTION_KEY);
        const key = 'iptvnator-server:synthetic-instance:history-consent-v1';
        const priorConsent = localStorage.getItem(key);
        const source = 'synthetic-source';
        const row = {
            id: 42,
            xtream_id: 42,
            type: 'series',
            title: 'Synthetic shared series',
        };
        try {
            localStorage.setItem(
                CONNECTION_KEY,
                JSON.stringify({
                    apiUrl: 'https://history.example.test/api',
                    instanceId: 'synthetic-instance',
                })
            );
            await prepareSourceConnection();
            localStorage.removeItem(key);
            let complete!: (items: unknown[]) => void;
            dataSource.getRecentItems.mockReturnValueOnce(
                new Promise((resolve) => {
                    complete = resolve;
                })
            );
            patchState(store, { playlistId: source });
            store.loadRecentItems({ id: source });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(dataSource.getRecentItems).toHaveBeenCalledWith(source);

            localStorage.setItem(
                key,
                JSON.stringify({
                    enabled: true,
                    generation: 'synthetic-generation',
                    deviceId: 'synthetic-device',
                })
            );
            complete([{ ...row, xtream_id: 77 }]);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(store.recentItems()).toEqual([]);

            dataSource.getRecentItems.mockResolvedValue([row]);
            window.dispatchEvent(new Event('iptvnator-history-changed'));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(store.recentItems()).toEqual([
                expect.objectContaining({ xtream_id: 42, type: 'series' }),
            ]);
        } finally {
            if (connection == null) localStorage.removeItem(CONNECTION_KEY);
            else localStorage.setItem(CONNECTION_KEY, connection);
            if (priorConsent == null) localStorage.removeItem(key);
            else localStorage.setItem(key, priorConsent);
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
        patchState(store, { playlistId: 'synthetic-source' });
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
