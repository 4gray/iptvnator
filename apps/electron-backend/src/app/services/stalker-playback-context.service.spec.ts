import { LEGACY_DEFAULT_STALKER_SERIAL } from '@iptvnator/shared/interfaces';
import {
    getStalkerPlaybackContextHeaders,
    rememberStalkerPlaybackContext,
} from './stalker-playback-context.service';

describe('stalker playback context', () => {
    const macAddress = '00:1A:79:AA:BB:CC';

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
});
