import { collectionSkeletonShowsEpg } from './unified-collection-skeleton';

describe('collectionSkeletonShowsEpg', () => {
    const pwa = { xmltv: false, provider: true };
    const desktop = { xmltv: true, provider: true };
    const none = { xmltv: false, provider: false };

    it('reserves the programme line for one portal playlist with a provider guide (browser PWA)', () => {
        expect(collectionSkeletonShowsEpg('xtream', 'playlist', pwa)).toBe(
            true
        );
        expect(collectionSkeletonShowsEpg('stalker', 'playlist', pwa)).toBe(
            true
        );
    });

    it('keeps one M3U playlist compact without XMLTV', () => {
        expect(collectionSkeletonShowsEpg('m3u', 'playlist', pwa)).toBe(false);
    });

    it('reserves the line across all playlists whenever any guide exists', () => {
        expect(collectionSkeletonShowsEpg(undefined, 'all', pwa)).toBe(true);
        expect(collectionSkeletonShowsEpg('m3u', 'all', pwa)).toBe(true);
        expect(collectionSkeletonShowsEpg(undefined, 'all', none)).toBe(false);
        expect(collectionSkeletonShowsEpg('xtream', 'playlist', none)).toBe(
            false
        );
    });

    it('reserves the line everywhere on the desktop', () => {
        for (const portalType of ['m3u', 'xtream', 'stalker', undefined]) {
            expect(
                collectionSkeletonShowsEpg(portalType, 'playlist', desktop)
            ).toBe(true);
            expect(collectionSkeletonShowsEpg(portalType, 'all', desktop)).toBe(
                true
            );
        }
    });
});
