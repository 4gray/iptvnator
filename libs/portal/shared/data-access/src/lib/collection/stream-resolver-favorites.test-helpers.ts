import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { StreamResolverService } from './stream-resolver.service';

export function registerUnavailableFavoriteEpgTests(
    getContext: () => {
        service: StreamResolverService;
        xtreamApi: { getShortEpg: jest.Mock };
        dataService: { sendIpcEvent: jest.Mock };
    }
) {
    it.each(['missing', 'unknown'] as const)(
        'skips EPG requests for an unavailable saved channel (%s)',
        async (catalogStatus) => {
            const { service, xtreamApi, dataService } = getContext();
            const item: UnifiedCollectionItem = {
                uid: 'saved-1',
                name: 'ABC',
                contentType: 'live',
                sourceType: 'xtream',
                playlistId: 'xtream-1',
                playlistName: 'Xtream',
                xtreamId: 1,
                catalogStatus,
            };
            expect((await service.loadEpgForItems([item])).size).toBe(0);
            expect(xtreamApi.getShortEpg).not.toHaveBeenCalled();
            expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        }
    );
}
