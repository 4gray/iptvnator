import {
    buildStalkerEpgMappingKey,
    buildXtreamEpgMappingKey,
} from './epg-mapping-key.util';

describe('buildXtreamEpgMappingKey', () => {
    it('scopes the key to the playlist', () => {
        expect(buildXtreamEpgMappingKey('playlist-a', 12345)).toBe(
            'xtream:playlist-a:12345'
        );
    });

    it('produces distinct keys for the same stream id in different playlists', () => {
        expect(buildXtreamEpgMappingKey('playlist-a', 12345)).not.toBe(
            buildXtreamEpgMappingKey('playlist-b', 12345)
        );
    });

    it('accepts string stream ids', () => {
        expect(buildXtreamEpgMappingKey('playlist-a', '42')).toBe(
            'xtream:playlist-a:42'
        );
    });
});

describe('buildStalkerEpgMappingKey', () => {
    it('scopes the key to the playlist', () => {
        expect(buildStalkerEpgMappingKey('portal-a', '205')).toBe(
            'stalker:portal-a:205'
        );
    });

    it('never collides with the Xtream key space', () => {
        expect(buildStalkerEpgMappingKey('p', 1)).not.toBe(
            buildXtreamEpgMappingKey('p', 1)
        );
    });
});
