import { readStreamInfo } from './vod-source-resolver.service';

/**
 * Xtream panels disagree about the shape of `info.video` / `info.audio`.
 *
 * The declared shape is a string array and that is what the mock server and
 * many panels send; others send the ffprobe object. Reading only one of them
 * loses the provider's codec on every response of the other kind.
 *
 * What the array shape carries is a CODEC and nothing else — no language — so
 * it can never feed the "dub may differ" warning. That is the honest outcome
 * rather than a gap: a codec cannot tell one dub from another.
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

    it('finds no language in the declared array shape', () => {
        // The shape the repo's own mock sends. It states a codec, so the dub
        // warning stays silent on every source that arrives this way — which
        // is most of them, and is correct: AAC says nothing about which dub
        // this is.
        const audio = readStreamInfo(['AAC']);

        expect(audio?.language).toBeUndefined();
        expect(audio?.tags?.language).toBeUndefined();
    });

    it('reads the language out of ffprobe tags when a panel sends them', () => {
        expect(
            readStreamInfo({ codec_name: 'ac3', tags: { language: 'rus' } })
                ?.tags?.language
        ).toBe('rus');
        // Some panels hoist it out of `tags`.
        expect(
            readStreamInfo({ codec_name: 'ac3', language: 'eng' })?.language
        ).toBe('eng');
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
