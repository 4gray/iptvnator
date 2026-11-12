import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { hasM3uSourceChanged } from './playlist-source-change';

const fromUrl = { _id: 'a', url: 'https://old.test/list.m3u' } as PlaylistMeta;
const fromFile = { _id: 'b', filePath: '/old/list.m3u' } as PlaylistMeta;

describe('hasM3uSourceChanged (#1677)', () => {
    it('detects a new URL or file path', () => {
        expect(
            hasM3uSourceChanged(fromUrl, {
                ...fromUrl,
                url: 'https://new.test/list.m3u',
            })
        ).toBe(true);
        expect(
            hasM3uSourceChanged(fromFile, {
                ...fromFile,
                filePath: '/new/list.m3u',
            })
        ).toBe(true);
    });

    it('ignores a save that keeps the source', () => {
        expect(
            hasM3uSourceChanged(fromUrl, { ...fromUrl, title: 'Renamed' })
        ).toBe(false);
        expect(hasM3uSourceChanged(fromFile, { ...fromFile })).toBe(false);
    });

    it('ignores Xtream and Stalker playlists', () => {
        const xtream = {
            _id: 'x',
            serverUrl: 'https://panel.test',
            url: 'https://panel.test/get.php',
        } as PlaylistMeta;
        const stalker = {
            _id: 's',
            portalUrl: 'http://portal.test/c/',
            url: 'http://portal.test/c/',
        } as PlaylistMeta;
        expect(
            hasM3uSourceChanged(xtream, {
                ...xtream,
                url: 'https://other.test',
            })
        ).toBe(false);
        expect(
            hasM3uSourceChanged(stalker, {
                ...stalker,
                url: 'http://other.test/c/',
            })
        ).toBe(false);
    });
});
