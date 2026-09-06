import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    STALKER_MAG_USER_AGENT,
    STALKER_STREAM_USER_AGENT,
    buildStalkerExternalPlaybackHeaders,
    isCrossOriginStalkerStream,
} from './stalker-live-playback.utils';
import { STALKER_SERIAL_NUMBER } from './stalker-session.service';

function createPlaylist(overrides: Partial<PlaylistMeta> = {}): PlaylistMeta {
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
    it.each([
        ['http://portal.test/c/', 'http://cdn.other.test/episode.mkv'],
        ['https://portal.test/c/', 'http://portal.test/episode.mkv'],
        ['http://portal.test/c/', 'http://portal.test/episode.mkv'],
    ])(
        'leaves HTTP byte ranges to the player for %s → %s',
        (portalUrl, streamUrl) => {
            const headers = buildStalkerExternalPlaybackHeaders(
                createPlaylist({ portalUrl }),
                'TOKEN',
                streamUrl
            );

            // A static bytes=0- overrides mpv's per-seek byte offset. The server
            // then returns the beginning again instead of the requested segment.
            expect(
                Object.keys(headers).map((name) => name.toLowerCase())
            ).not.toContain('range');
        }
    );

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

    it('sends the MAG User-Agent alongside X-User-Agent for portal-owned streams', () => {
        // The API request path always sent both; the playback header set
        // previously carried only X-User-Agent (audit finding 5).
        const headers = buildStalkerExternalPlaybackHeaders(
            createPlaylist(),
            'TOKEN',
            'http://portal.test/live/ch1.ts'
        );

        expect(headers['User-Agent']).toBe(STALKER_MAG_USER_AGENT);
        expect(headers['X-User-Agent']).toBe(STALKER_MAG_USER_AGENT);
        expect(headers['Cookie']).toContain('mac=00:1A:79:AA:BB:CC');
        expect(headers['Authorization']).toBe('Bearer TOKEN');
    });

    it('lets a playlist-level custom User-Agent take precedence over the MAG UA', () => {
        const headers = buildStalkerExternalPlaybackHeaders(
            createPlaylist({ userAgent: 'CustomAgent/9.9' }),
            'TOKEN',
            'http://portal.test/live/ch1.ts'
        );

        expect(headers['User-Agent']).toBe('CustomAgent/9.9');
        expect(headers['X-User-Agent']).toBe(STALKER_MAG_USER_AGENT);
    });

    it('keeps portal credentials for a same-host stream on another port', () => {
        // Panels routinely serve streams from :8080 next to the portal on
        // :80, and exactly those streams are gated on the portal cookie
        // (#1158 class) — a strict origin comparison used to push them onto
        // the credential-free KSPlayer profile.
        const headers = buildStalkerExternalPlaybackHeaders(
            createPlaylist(),
            'TOKEN',
            'http://portal.test:8080/live/ch1.ts'
        );

        expect(headers['Cookie']).toContain('mac=00:1A:79:AA:BB:CC');
        expect(headers['Authorization']).toBe('Bearer TOKEN');
        expect(headers['User-Agent']).toBe(STALKER_MAG_USER_AGENT);
    });

    it('uses the credential-free direct profile for foreign hosts', () => {
        const headers = buildStalkerExternalPlaybackHeaders(
            createPlaylist(),
            'TOKEN',
            'http://cdn.other.test/live/ch1.ts'
        );

        expect(headers['User-Agent']).toBe(STALKER_STREAM_USER_AGENT);
        expect(headers['Cookie']).toBeUndefined();
        expect(headers['Authorization']).toBeUndefined();
    });

    it('uses the credential-free profile on an https→http downgrade', () => {
        const headers = buildStalkerExternalPlaybackHeaders(
            createPlaylist({
                portalUrl: 'https://portal.test/stalker_portal/c/index.html',
            }),
            'TOKEN',
            'http://portal.test/live/ch1.ts'
        );

        expect(headers['User-Agent']).toBe(STALKER_STREAM_USER_AGENT);
        expect(headers['Cookie']).toBeUndefined();
        expect(headers['Authorization']).toBeUndefined();
    });
});

describe('isCrossOriginStalkerStream', () => {
    it('treats same-host port and scheme-upgrade changes as portal-owned', () => {
        const playlist = createPlaylist();

        expect(
            isCrossOriginStalkerStream(
                playlist,
                'http://portal.test:8080/live/ch1.ts'
            )
        ).toBe(false);
        expect(
            isCrossOriginStalkerStream(
                playlist,
                'https://portal.test/live/ch1.ts'
            )
        ).toBe(false);
    });

    it('treats foreign hosts and TLS downgrades as cross-origin', () => {
        expect(
            isCrossOriginStalkerStream(
                createPlaylist(),
                'http://cdn.other.test/live/ch1.ts'
            )
        ).toBe(true);
        expect(
            isCrossOriginStalkerStream(
                createPlaylist({
                    portalUrl:
                        'https://portal.test/stalker_portal/c/index.html',
                }),
                'http://portal.test/live/ch1.ts'
            )
        ).toBe(true);
    });

    it('returns false when the playlist or stream URL is missing', () => {
        expect(isCrossOriginStalkerStream(undefined, 'http://x.test/1')).toBe(
            false
        );
        expect(isCrossOriginStalkerStream(createPlaylist(), undefined)).toBe(
            false
        );
    });
});
