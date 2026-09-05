import { LEGACY_DEFAULT_STALKER_SERIAL } from '@iptvnator/shared/interfaces';
import {
    getStalkerPlaybackContextHeaders,
    rememberStalkerPlaybackContext,
} from './stalker-playback-context.service';

describe('stalker playback context', () => {
    const macAddress = '00:1A:79:AA:BB:CC';

    it.each([
        ['http://range-portal.test/c/', 'http://range-cdn.test/episode.mkv'],
        [
            'https://range-downgrade.test/c/',
            'http://range-downgrade.test/episode.mkv',
        ],
        ['http://range-owned.test/c/', 'http://range-owned.test/episode.mkv'],
    ])(
        'leaves seek byte ranges to the player for %s → %s',
        (portalUrl, streamUrl) => {
            rememberStalkerPlaybackContext({
                streamUrl,
                portalUrl,
                macAddress,
            });

            const headers = getStalkerPlaybackContextHeaders(streamUrl);

            expect(headers).not.toBeNull();
            expect(
                Object.keys(headers ?? {}).map((name) => name.toLowerCase())
            ).not.toContain('range');
        }
    );

    function rememberSameOriginContext(
        name: string,
        serialNumber?: string
    ): Record<string, string> {
        const origin = `http://${name}.example.test`;
        const streamUrl = `${origin}/stream/1.ts`;

        rememberStalkerPlaybackContext({
            streamUrl,
            portalUrl: `${origin}/stalker_portal/server/load.php`,
            macAddress,
            serialNumber,
            token: 'token-1',
        });

        return getStalkerPlaybackContextHeaders(streamUrl) ?? {};
    }

    it('does not add SN or a serial-derived __cfduid when serial is absent', () => {
        const headers = rememberSameOriginContext('stalker-no-serial');

        expect(headers).not.toHaveProperty('SN');
        expect(headers['Cookie']).not.toContain('__cfduid=');
    });

    it('preserves a provided serial and creates a canonical __cfduid', () => {
        const headers = rememberSameOriginContext(
            'stalker-with-serial',
            ' CustomSn123 '
        );
        const cfduid = headers['Cookie']?.match(/__cfduid=([^;]+)/)?.[1];

        expect(headers['SN']).toBe('CustomSn123');
        expect(cfduid).toHaveLength(32);
    });

    it('treats the legacy default serial as absent', () => {
        const headers = rememberSameOriginContext(
            'stalker-legacy-serial',
            LEGACY_DEFAULT_STALKER_SERIAL
        );

        expect(headers).not.toHaveProperty('SN');
        expect(headers['Cookie']).not.toContain('__cfduid=');
    });

    it('keeps the portal profile for a same-host stream on another port', () => {
        // Must match the renderer's classification: a same-host stream on a
        // different port stays portal-owned, or isStalkerDirectStreamProfile
        // would discard the renderer's credentialed headers for it.
        const streamUrl = 'http://same-host.example.test:8080/stream/1.ts';
        rememberStalkerPlaybackContext({
            streamUrl,
            portalUrl:
                'http://same-host.example.test/stalker_portal/server/load.php',
            macAddress,
            token: 'token-1',
        });

        const headers = getStalkerPlaybackContextHeaders(streamUrl) ?? {};

        expect(headers['Cookie']).toContain(`mac=${macAddress}`);
        expect(headers['Authorization']).toBe('Bearer token-1');
        expect(headers['User-Agent']).not.toBe('KSPlayer');
    });

    it('uses the credential-free direct profile for foreign hosts', () => {
        const streamUrl = 'http://cdn.foreign.example.test/stream/1.ts';
        rememberStalkerPlaybackContext({
            streamUrl,
            portalUrl:
                'http://portal.foreign-case.example.test/stalker_portal/server/load.php',
            macAddress,
            token: 'token-1',
        });

        const headers = getStalkerPlaybackContextHeaders(streamUrl) ?? {};

        expect(headers['User-Agent']).toBe('KSPlayer');
        expect(headers).not.toHaveProperty('Cookie');
        expect(headers).not.toHaveProperty('Authorization');
    });

    it('uses the credential-free profile on an https→http downgrade', () => {
        const streamUrl = 'http://downgrade.example.test/stream/1.ts';
        rememberStalkerPlaybackContext({
            streamUrl,
            portalUrl:
                'https://downgrade.example.test/stalker_portal/server/load.php',
            macAddress,
            token: 'token-1',
        });

        const headers = getStalkerPlaybackContextHeaders(streamUrl) ?? {};

        expect(headers['User-Agent']).toBe('KSPlayer');
        expect(headers).not.toHaveProperty('Cookie');
        expect(headers).not.toHaveProperty('Authorization');
    });

    describe('temporary-link retention', () => {
        // A Stalker temporary link expires after ~5 s. This map is a
        // header lookup keyed BY the stream URL the player is already
        // opening — it must never become a place a stale URL can be read
        // back out of and replayed.
        it('stores headers only, never the URL it was keyed with', () => {
            const streamUrl =
                'http://tmp-link.example.test/ch/1?token=SECRET-TMP';
            rememberStalkerPlaybackContext({
                streamUrl,
                portalUrl:
                    'http://tmp-link.example.test/stalker_portal/server/load.php',
                macAddress,
                token: 'token-1',
            });

            const headers = getStalkerPlaybackContextHeaders(streamUrl) ?? {};

            expect(Object.keys(headers).length).toBeGreaterThan(0);
            expect(JSON.stringify(headers)).not.toContain('SECRET-TMP');
            expect(JSON.stringify(headers)).not.toContain('/ch/1');
        });

        it('matches a re-minted link that differs only in its expiring query', () => {
            // Consecutive create_link calls return the same path with a fresh
            // token; the lookup keys on origin+path so the second link still
            // finds its portal headers instead of playing bare.
            const firstLink = 'http://tmp-link2.example.test/ch/7?token=first';
            const secondLink =
                'http://tmp-link2.example.test/ch/7?token=second';
            rememberStalkerPlaybackContext({
                streamUrl: firstLink,
                portalUrl:
                    'http://tmp-link2.example.test/stalker_portal/server/load.php',
                macAddress,
                token: 'token-1',
            });

            expect(
                getStalkerPlaybackContextHeaders(secondLink)?.['Cookie']
            ).toContain(`mac=${macAddress}`);
        });
    });
});
