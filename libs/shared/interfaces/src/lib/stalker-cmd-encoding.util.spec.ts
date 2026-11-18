import { encodeStalkerCmdValue } from './stalker-cmd-encoding.util';

/**
 * One application-x-www-form-urlencoded decode, the way PHP's `$_GET` (and
 * Express' query parser) sees the value: `+` is a space, `%XX` decodes once.
 */
function portalVisibleValue(encoded: string): string {
    return decodeURIComponent(encoded.replace(/\+/g, '%20'));
}

describe('encodeStalkerCmdValue', () => {
    it('keeps a plain solution-prefixed cmd readable (space only)', () => {
        expect(encodeStalkerCmdValue('ffrt3 http://host/ch/123')).toBe(
            'ffrt3%20http://host/ch/123'
        );
    });

    it('keeps ?, = and : raw in a tokened cmd', () => {
        expect(
            encodeStalkerCmdValue('auto http://host/ch/123?token=abc')
        ).toBe('auto%20http://host/ch/123?token=abc');
    });

    it('leaves a bare media path untouched', () => {
        expect(encodeStalkerCmdValue('/media/12345.mpg')).toBe(
            '/media/12345.mpg'
        );
    });

    it('never double-encodes pre-encoded sequences', () => {
        expect(
            encodeStalkerCmdValue('auto http://host/s/a%3Ab%20c.m3u8')
        ).toBe('auto%20http://host/s/a%3Ab%20c.m3u8');
    });

    it('passes a bare, malformed % through untouched', () => {
        expect(encodeStalkerCmdValue('/media/100%.mpg')).toBe(
            '/media/100%.mpg'
        );
    });

    it('encodes the query-structure characters &, # and ;', () => {
        expect(encodeStalkerCmdValue('a&b#c;d')).toBe('a%26b%23c%3Bd');
    });

    it('keeps + raw so the portal sees a space, like it does for a real STB', () => {
        const encoded = encodeStalkerCmdValue('auto http://host/s/a+b.ts');
        expect(encoded).toBe('auto%20http://host/s/a+b.ts');
        expect(portalVisibleValue(encoded)).toBe('auto http://host/s/a b.ts');
    });

    it('keeps IPv6 literals byte-identical', () => {
        expect(encodeStalkerCmdValue('ffmpeg http://[::1]:8080/ch/1')).toBe(
            'ffmpeg%20http://[::1]:8080/ch/1'
        );
    });

    it('encodes quotes, backslash and control characters', () => {
        expect(encodeStalkerCmdValue(`a"b'c\\d\ne`)).toBe(
            'a%22b%27c%5Cd%0Ae'
        );
    });

    it('percent-encodes non-ASCII as UTF-8', () => {
        expect(encodeStalkerCmdValue('auto http://host/канал/1')).toBe(
            'auto%20http://host/%D0%BA%D0%B0%D0%BD%D0%B0%D0%BB/1'
        );
    });

    it('survives WHATWG URL re-parsing byte-identically', () => {
        const corpus = [
            'ffrt3 http://host/ch/123',
            'auto http://host/ch/123?token=abc',
            '/media/12345.mpg',
            'auto http://host/s/a%3Ab%20c.m3u8',
            "a&b#c;d'e\"f",
            'ffmpeg http://[::1]:8080/ch/1',
            'auto http://host/канал/1',
        ];
        for (const cmd of corpus) {
            const query = `cmd=${encodeStalkerCmdValue(cmd)}`;
            expect(new URL(`http://portal/load.php?${query}`).search).toBe(
                `?${query}`
            );
        }
    });

    it('is value-preserving after one server-side decode for every escaped character', () => {
        const original = `ffrt http://h/s?a=1&b=2#f;g "q" 'x' я`;
        expect(portalVisibleValue(encodeStalkerCmdValue(original))).toBe(
            original
        );
    });
});
