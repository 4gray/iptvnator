import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { buildStalkerExternalPlaybackHeaders } from './stalker-live-playback.utils';
import { STALKER_SERIAL_NUMBER } from './stalker-session.service';

function createPlaylist(
    overrides: Partial<PlaylistMeta> = {}
): PlaylistMeta {
    return {
        _id: 'playlist-1',
        title: 'Playlist',
        filename: '',
        count: 0,
        url: '',
        importDate: '',
        filePath: '',
        updateDate: '',
        updateState: '',
        position: 0,
        autoRefresh: false,
        favorites: [],
        serverUrl: '',
        username: '',
        password: '',
        macAddress: '00:1A:79:AA:BB:CC',
        hiddenGroupTitles: [],
        portalUrl: 'http://portal.test/stalker_portal/c/index.html',
        recentlyViewed: [],
        isFullStalkerPortal: true,
        ...overrides,
    };
}

describe('buildStalkerExternalPlaybackHeaders', () => {
    it('treats the legacy default serial as absent', () => {
        const headers = buildStalkerExternalPlaybackHeaders(
            createPlaylist({ stalkerSerialNumber: STALKER_SERIAL_NUMBER }),
            'TOKEN',
            'http://portal.test/stalker_portal/server/load.php'
        );

        expect(headers).not.toHaveProperty('SN');
        expect(headers['Cookie']).not.toContain('__cfduid=');
    });

    it('trims a provided serial before adding same-origin playback headers', () => {
        const headers = buildStalkerExternalPlaybackHeaders(
            createPlaylist({ stalkerSerialNumber: '  CustomSn123  ' }),
            'TOKEN',
            'http://portal.test/stalker_portal/server/load.php'
        );

        expect(headers['SN']).toBe('CustomSn123');
        expect(headers['Cookie']).toContain('__cfduid=');
    });

    it('uses a canonical 32-character __cfduid when serial is provided', () => {
        const headers = buildStalkerExternalPlaybackHeaders(
            createPlaylist({ stalkerSerialNumber: '  CustomSn123  ' }),
            'TOKEN',
            'http://portal.test/stalker_portal/server/load.php'
        );

        const cfduid = headers['Cookie']?.match(/__cfduid=([^;]+)/)?.[1];
        expect(cfduid).toHaveLength(32);
    });
});
