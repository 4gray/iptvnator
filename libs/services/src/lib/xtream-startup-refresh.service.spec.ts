import { TestBed } from '@angular/core/testing';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
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
    const fetcher = { categories: jest.fn(), content: jest.fn() };
    const refresh = { refreshLiveOnStartup: jest.fn(), progress: () => null };

    beforeEach(() => {
        fetcher.categories.mockReset().mockResolvedValue(categories);
        fetcher.content.mockReset().mockResolvedValue(content);
        refresh.refreshLiveOnStartup.mockReset().mockResolvedValue(true);
        TestBed.configureTestingModule({
            providers: [
                { provide: XtreamCatalogFetchService, useValue: fetcher },
                {
                    provide: XtreamSelectedCatalogRefreshService,
                    useValue: refresh,
                },
                {
                    provide: ParentalLockService,
                    useValue: {
                        initialize: async () => undefined,
                        locksReadable: () => true,
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
        expect(fetcher.categories).toHaveBeenCalledWith(source, 'live');
        expect(fetcher.content).toHaveBeenCalledWith(source, 'live');
        expect(refresh.refreshLiveOnStartup).not.toHaveBeenCalled();
        release();
        await expect(result).resolves.toBe(true);
        expect(refresh.refreshLiveOnStartup).toHaveBeenCalledWith(source, {
            type: 'live',
            categories,
            content,
        });
    });

    it('keeps the saved lineup when the provider returns no live channels', async () => {
        fetcher.content.mockResolvedValue([]);
        await expect(service.refreshLive(source)).rejects.toThrow(
            'usable live catalog'
        );
        expect(refresh.refreshLiveOnStartup).not.toHaveBeenCalled();
    });

    it('keeps the saved lineup when the provider cannot be reached', async () => {
        fetcher.content.mockRejectedValue(new Error('Provider offline'));
        await expect(service.refreshLive(source)).rejects.toThrow(
            'Provider offline'
        );
        expect(refresh.refreshLiveOnStartup).not.toHaveBeenCalled();
    });
});
