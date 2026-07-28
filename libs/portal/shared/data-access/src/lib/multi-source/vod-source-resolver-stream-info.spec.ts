import { readStreamInfo } from './vod-source-resolver.service';

/**
 * Xtream panels disagree about the shape of `info.video` / `info.audio`.
 *
 * The declared shape is a string array and that is what the mock server and
 * many panels send; others send the ffprobe object. Reading only one of them
 * loses the provider's codec on every response of the other kind — and with
 * it the "dub may differ" warning, which compares stated audio tracks.
 */
describe('readStreamInfo', () => {
    it('reads the declared array shape', () => {
        expect(readStreamInfo(['H.264'])).toEqual({ codec_name: 'H.264' });
        expect(readStreamInfo(['AAC'])).toEqual({ codec_name: 'AAC' });
    });

    it('reads the ffprobe object shape, dimensions included', () => {
        expect(
            readStreamInfo({ codec_name: 'hevc', width: 3840, height: 2160 })
        ).toEqual({ codec_name: 'hevc', width: 3840, height: 2160 });
    });

    it('skips blank entries rather than stating an empty codec', () => {
        expect(readStreamInfo(['', '   ', 'H.264'])).toEqual({
            codec_name: 'H.264',
        });
    });

    it('trims, since the value is published as a fact', () => {
        expect(readStreamInfo([' H.264 '])).toEqual({ codec_name: 'H.264' });
    });

    it('says nothing when the provider said nothing', () => {
        // Empty beats wrong: an absent codec must not become a stated one.
        expect(readStreamInfo([])).toBeUndefined();
        expect(readStreamInfo(['', ' '])).toBeUndefined();
        expect(readStreamInfo(undefined)).toBeUndefined();
        expect(readStreamInfo(null)).toBeUndefined();
        expect(readStreamInfo('H.264')).toBeUndefined();
    });
});
