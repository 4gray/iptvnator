import {
    collectPlaybackCodecs,
    getPlaybackDrmSystem,
} from './playback-stream-metadata';

describe('safe playback source metadata', () => {
    it('retains codec identifiers and discards provider text, URLs and unsupported shapes', () => {
        expect(
            collectPlaybackCodecs([
                {
                    videoCodec: 'avc1.64001e, hvc1.1.6.L93.B0',
                    audioCodec: 'mp4a.40.2, ac-3',
                },
                {
                    videoCodec: 'https://secret.test/?token=secret',
                    audioCodec: 'Authorization: secret',
                },
                { videoCodec: { token: 'secret' }, audioCodec: 17 },
                { videoCodec: 'avc1.64001e', audioCodec: 'mp4a.40.2' },
            ])
        ).toEqual({
            videoCodecs: ['avc1.64001e', 'hvc1.1.6.L93.B0'],
            audioCodecs: ['mp4a.40.2', 'ac-3'],
        });
    });

    it('retains full AV1 codec strings with color metadata', () => {
        const fullAv1 = 'av01.0.04M.08.0.110.01.01.01.0';
        expect(
            collectPlaybackCodecs([{ videoCodec: fullAv1 }]).videoCodecs
        ).toEqual([fullAv1]);
        expect(
            collectPlaybackCodecs([{ videoCodec: fullAv1 + '.0' }]).videoCodecs
        ).toEqual([]);
    });

    it('does not confuse generic CENC with a named DRM system', () => {
        expect(
            getPlaybackDrmSystem('urn:mpeg:dash:mp4protection:2011')
        ).toBeUndefined();
        expect(
            getPlaybackDrmSystem(
                'urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b'
            )
        ).toBeUndefined();
        expect(getPlaybackDrmSystem('widevine-secret-token')).toBeUndefined();
        expect(getPlaybackDrmSystem(' COM.WIDEVINE.ALPHA ')).toBe('widevine');
    });

    it('bounds retained codec lists', () => {
        const tracks = Array.from({ length: 300 }, (_, i) => ({
            videoCodec: `avc1.${i.toString(16).padStart(6, '0')}`,
        }));
        expect(collectPlaybackCodecs(tracks).videoCodecs).toHaveLength(16);
    });
});
