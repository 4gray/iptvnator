import { UnifiedRecentDataService } from './unified-recent-data.service';
import { of } from 'rxjs';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';

it('updates the recent UI without writing a received projection over the retained archive', async () => {
    const archived = [{ id: 'local-archive' }];
    let persisted = archived;
    const dispatch = jest.fn((action) => {
        if (action.persist !== false)
            persisted = action.playlist.recentlyViewed;
    });
    const service = Object.assign(
        Object.create(UnifiedRecentDataService.prototype),
        {
            store: { dispatch },
            playlistsService: {
                addM3uRecentlyViewed: () =>
                    of({ recentlyViewed: [{ id: 'remote-projection' }] }),
            },
        }
    ) as UnifiedRecentDataService;
    await service.recordLivePlayback({
        playlistId: 'source',
        sourceType: 'm3u',
        streamUrl: 'https://synthetic.invalid/stream',
        name: 'Synthetic channel',
    } as UnifiedCollectionItem);
    expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ persist: false })
    );
    expect(persisted).toBe(archived);
});
