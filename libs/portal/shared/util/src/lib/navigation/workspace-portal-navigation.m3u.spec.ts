import { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';
import { getUnifiedCollectionNavigation } from './workspace-portal-navigation';

const item = (
    overrides: Partial<UnifiedCollectionItem> = {}
): UnifiedCollectionItem =>
    ({
        uid: 'm3u::pl-1::http://h.example/movie/1.mkv',
        name: 'Dune',
        contentType: 'movie',
        sourceType: 'm3u',
        playlistId: 'pl-1',
        playlistName: 'List',
        streamUrl: 'http://h.example/movie/1.mkv',
        ...overrides,
    }) as UnifiedCollectionItem;

describe('getUnifiedCollectionNavigation for M3U', () => {
    it.each(['movie', 'series', 'live'] as const)(
        'opens a %s row in its playlist',
        (contentType) => {
            // One branch for every kind: the player decides what to show
            // once the row is selected.
            expect(
                getUnifiedCollectionNavigation(item({ contentType }))
            ).toEqual({
                link: ['/workspace', 'playlists', 'pl-1', 'all'],
                state: {
                    openM3uChannelUrl: 'http://h.example/movie/1.mkv',
                },
            });
        }
    );

    it('refuses a row with no stream URL', () => {
        // Nothing to select on arrival, so navigating would strand the
        // viewer on an unrelated list.
        expect(
            getUnifiedCollectionNavigation(item({ streamUrl: undefined }))
        ).toBeNull();
        expect(
            getUnifiedCollectionNavigation(item({ streamUrl: '   ' }))
        ).toBeNull();
    });
});
