import { TestBed } from '@angular/core/testing';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { DatabaseService } from './database-electron.service';
import { ParentalLockService } from './parental-lock';
import { SourceActivityService } from './source-activity.service';
import { XtreamCatalogFetchService } from './xtream-catalog-fetch.service';
import { XtreamSelectedCatalogRefreshService } from './xtream-selected-catalog-refresh.service';
import { XtreamStartupRefreshService } from './xtream-startup-refresh.service';

const source: PlaylistMeta = {
    _id: 'source',
    title: 'Test source',
    autoRefresh: true,
    count: 0,
    importDate: '2026-01-01',
};
const categories = [{ category_id: '4', category_name: 'News', parent_id: 0 }];
const content = [{ category_id: '4', stream_id: 42, name: 'Test channel' }];

describe('Xtream startup refresh', () => {
    let service: XtreamStartupRefreshService;
    let activity: SourceActivityService;
    const db = { getAllXtreamCategories: jest.fn() };
    const locksReadable = jest.fn(() => true);
    const fetcher = { categories: jest.fn(), content: jest.fn() };
    const refresh = { refreshLiveOnStartup: jest.fn(), progress: () => null };

    beforeEach(() => {
        locksReadable.mockReturnValue(true);
        db.getAllXtreamCategories
            .mockReset()
            .mockResolvedValue([{ id: 11, xtream_id: 4 }]);
        fetcher.categories.mockReset().mockResolvedValue(categories);
        fetcher.content.mockReset().mockResolvedValue(content);
        refresh.refreshLiveOnStartup
            .mockReset()
            .mockImplementation(
                async (_source, _catalog, capturePreviousCategories) => {
                    await capturePreviousCategories();
                    return true;
                }
            );
        TestBed.configureTestingModule({
            providers: [
                { provide: DatabaseService, useValue: db },
                { provide: XtreamCatalogFetchService, useValue: fetcher },
                {
                    provide: XtreamSelectedCatalogRefreshService,
                    useValue: refresh,
                },
                {
                    provide: ParentalLockService,
                    useValue: {
                        initialize: async () => undefined,
                        locksReadable,
                    },
                },
            ],
        });
        activity = TestBed.inject(SourceActivityService);
        service = TestBed.inject(XtreamStartupRefreshService);
    });

    it('fetches Live TV while a routed reader holds the source and waits to replace it', async () => {
        const release = activity.begin([source._id]);
        let didFetch!: () => void;
        const fetched = new Promise<void>((resolve) => {
            didFetch = resolve;
        });
        fetcher.content.mockImplementation(async () => {
            didFetch();
            return content;
        });

        const result = service.refreshLive(source);
        await fetched;
        await Promise.resolve();
        expect(fetcher.categories).toHaveBeenCalledWith(source, 'live');
        expect(fetcher.content).toHaveBeenCalledWith(source, 'live');
        expect(refresh.refreshLiveOnStartup).not.toHaveBeenCalled();
        release();
        await expect(result).resolves.toBe(true);
        expect(refresh.refreshLiveOnStartup).toHaveBeenCalledWith(
            source,
            {
                type: 'live',
                categories,
                content,
            },
            expect.any(Function)
        );
    });

    it('retains live category rows by provider ID and records removed IDs', async () => {
        db.getAllXtreamCategories.mockResolvedValue([
            { id: 11, xtream_id: 4 },
            { id: 22, xtream_id: 7 },
        ]);
        refresh.refreshLiveOnStartup.mockImplementationOnce(
            async (_source, _catalog, readRetainedCategoryIds) => {
                expect(await readRetainedCategoryIds()).toEqual([[4, 11]]);
                return true;
            }
        );
        await service.refreshLive(source);
        service.recordUpdate(source._id, 42);

        expect(service.wasLiveCategoryRemoved(source._id, 42, 11)).toBe(false);
        expect(service.wasLiveCategoryRemoved(source._id, 43, 22)).toBe(false);
        expect(service.wasLiveCategoryRemoved(source._id, 42, 22)).toBe(true);
    });

    it('leaves the catalog alone when parental locks cannot be read', async () => {
        locksReadable.mockReturnValue(false);
        await expect(service.refreshLive(source)).rejects.toThrow(
            'parental locks'
        );
        expect(fetcher.categories).not.toHaveBeenCalled();
        expect(refresh.refreshLiveOnStartup).not.toHaveBeenCalled();
    });

    it.each([
        {
            category_id: 'invalid',
            category_name: 'Synthetic category',
            parent_id: 0,
        },
        { category_id: '4', parent_id: 0 },
    ])(
        'leaves the cached catalog in place for malformed categories',
        async (category) => {
            fetcher.categories.mockResolvedValue([category]);
            await expect(service.refreshLive(source)).rejects.toThrow(
                'usable live catalog'
            );
            expect(refresh.refreshLiveOnStartup).not.toHaveBeenCalled();
        }
    );

    it('keeps the saved lineup when the provider returns no live channels', async () => {
        fetcher.content.mockResolvedValue([]);
        await expect(service.refreshLive(source)).rejects.toThrow(
            'usable live catalog'
        );
        expect(refresh.refreshLiveOnStartup).not.toHaveBeenCalled();
    });

    it.each([undefined, 0, -1, 1.5, '42broken', '4e2', '0x2a', true])(
        'keeps the saved lineup when a provider returns an invalid stream ID (%s)',
        async (streamId) => {
            fetcher.content.mockResolvedValue([
                ...content,
                { category_id: '4', stream_id: streamId },
            ]);
            await expect(service.refreshLive(source)).rejects.toThrow(
                'usable live catalog'
            );
            expect(refresh.refreshLiveOnStartup).not.toHaveBeenCalled();
        }
    );

    it('accepts a decimal stream ID sent as a string', async () => {
        fetcher.content.mockResolvedValue([{ ...content[0], stream_id: '42' }]);
        await expect(service.refreshLive(source)).resolves.toBe(true);
    });

    it('keeps the saved lineup when the provider cannot be reached', async () => {
        fetcher.content.mockRejectedValue(new Error('Provider offline'));
        await expect(service.refreshLive(source)).rejects.toThrow(
            'Provider offline'
        );
        expect(refresh.refreshLiveOnStartup).not.toHaveBeenCalled();
    });
});
