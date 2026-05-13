import {
    normalizeExternalPlayerArguments,
    parseExternalPlayerArguments,
} from './external-player-arguments.utils';

describe('external player arguments utils', () => {
    it('parses one argument per non-empty trimmed line', () => {
        expect(
            parseExternalPlayerArguments(
                '  --screen=1\n\n--geometry=1280x720\r\n  --hwdec=auto-safe  '
            )
        ).toEqual(['--screen=1', '--geometry=1280x720', '--hwdec=auto-safe']);
    });

    it('normalizes arguments to newline-separated trimmed lines', () => {
        expect(
            normalizeExternalPlayerArguments([
                ' --screen=1 ',
                '',
                ' --geometry=1280x720 ',
            ])
        ).toBe('--screen=1\n--geometry=1280x720');
    });

    it('treats missing or unsupported values as empty arguments', () => {
        expect(parseExternalPlayerArguments(undefined)).toEqual([]);
        expect(parseExternalPlayerArguments(null)).toEqual([]);
        expect(parseExternalPlayerArguments(123 as unknown as string)).toEqual(
            []
        );
        expect(normalizeExternalPlayerArguments('   \n  ')).toBe('');
    });
});
