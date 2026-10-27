import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { buildCollectionPortalNavigation } from './unified-collection-detail-navigation';

describe('M3U Recently Viewed Movies and Series navigation', () => {
    const movie: UnifiedCollectionItem = {
        uid: 'm3u::demo::movie',
        sourceType: 'm3u',
        contentType: 'movie',
        playlistId: 'demo',
        playlistName: 'Demo M3U',
        name: 'Test Movie',
        streamUrl: 'https://example.invalid/movie.mp4',
    };

    it('opens the actual watched movie channel, not the empty global detail route', () => {
        expect(buildCollectionPortalNavigation(movie, '/workspace/global-recent'))
            .toEqual({
                link: ['/workspace', 'playlists', 'demo', 'movies'],
                state: { openM3uChannelUrl: 'https://example.invalid/movie.mp4' },
            });
    });

    it('opens a watched series episode in the Series section', () => {
        const episode: UnifiedCollectionItem = {
            ...movie, contentType: 'series',
            name: 'Test Series S01E03',
            streamUrl: 'https://example.invalid/episode03.m3u8',
        };
        expect(buildCollectionPortalNavigation(episode, '/workspace/global-recent'))
            .toEqual({
                link: ['/workspace', 'playlists', 'demo', 'series'],
                state: { openM3uChannelUrl: 'https://example.invalid/episode03.m3u8' },
            });
    });

    it('does not invent a navigation when the original stream URL is missing', () => {
        expect(buildCollectionPortalNavigation({ ...movie, streamUrl: '' },
            '/workspace/global-recent')).toBeNull();
    });
});
