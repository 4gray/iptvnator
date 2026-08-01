import {
    escapeMpvStringListValue,
    joinMpvHeaderFields,
} from './mpv-string-list.util';

const MAG_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250';

describe('escapeMpvStringListValue', () => {
    it('escapes commas so mpv keeps them inside the value', () => {
        expect(escapeMpvStringListValue(`X-User-Agent: ${MAG_USER_AGENT}`)).toBe(
            'X-User-Agent: Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML\\, like Gecko) MAG250'
        );
    });

    it('escapes backslashes before commas so escaping round-trips', () => {
        expect(escapeMpvStringListValue('a\\b,c')).toBe('a\\\\b\\,c');
    });

    it('leaves comma-free values untouched', () => {
        expect(escapeMpvStringListValue('Referer: http://portal.example/c/')).toBe(
            'Referer: http://portal.example/c/'
        );
    });
});

describe('joinMpvHeaderFields', () => {
    it('joins fields with commas while protecting in-value commas', () => {
        const joined = joinMpvHeaderFields([
            `X-User-Agent: ${MAG_USER_AGENT}`,
            'Cookie: mac=00:1A:79:AA:BB:CC; stb_lang=en_US@rg=dezzzz',
        ]);

        expect(joined).toBe(
            'X-User-Agent: Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML\\, like Gecko) MAG250,' +
                'Cookie: mac=00:1A:79:AA:BB:CC; stb_lang=en_US@rg=dezzzz'
        );
        // Exactly one unescaped separator between the two fields.
        expect(joined.split(/(?<!\\),/)).toHaveLength(2);
    });
});
