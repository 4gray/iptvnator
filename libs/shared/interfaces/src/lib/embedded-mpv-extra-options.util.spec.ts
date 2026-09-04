import {
    EMBEDDED_MPV_NETWORK_DEFAULT_OPTIONS,
    normalizeEmbeddedMpvExtraOptions,
    parseEmbeddedMpvExtraOptions,
    resolveEmbeddedMpvSessionOptionArguments,
    validateEmbeddedMpvExtraOptions,
} from './embedded-mpv-extra-options.util';

describe('embedded MPV extra options', () => {
    it('parses one key=value pair per line and tolerates CRLF, spaces and a -- prefix', () => {
        expect(
            parseEmbeddedMpvExtraOptions(
                'hwdec = auto-safe\r\n\n  --cache-secs=30  \ndemuxer-lavf-o=reconnect=1,reconnect_delay_max=5'
            )
        ).toEqual([
            { key: 'hwdec', value: 'auto-safe' },
            { key: 'cache-secs', value: '30' },
            {
                key: 'demuxer-lavf-o',
                value: 'reconnect=1,reconnect_delay_max=5',
            },
        ]);
    });

    it('skips lines without a value or with a malformed key', () => {
        expect(
            parseEmbeddedMpvExtraOptions(
                'hwdec=\nno-border\n=auto\n bad key=1\nvolume=50'
            )
        ).toEqual([{ key: 'volume', value: '50' }]);
    });

    it('normalizes to canonical lines but keeps malformed lines for the user to fix', () => {
        expect(
            normalizeEmbeddedMpvExtraOptions(
                ' --hwdec = auto \n\nnot an option\n'
            )
        ).toBe('hwdec=auto\nnot an option');
        expect(normalizeEmbeddedMpvExtraOptions(undefined)).toBe('');
        expect(normalizeEmbeddedMpvExtraOptions(['a=1', '', 'b=2'])).toBe(
            'a=1\nb=2'
        );
    });

    it('reports malformed lines and forbidden keys separately', () => {
        expect(validateEmbeddedMpvExtraOptions('')).toBeNull();
        expect(validateEmbeddedMpvExtraOptions(undefined)).toBeNull();
        expect(validateEmbeddedMpvExtraOptions('hwdec=auto')).toBeNull();
        expect(
            validateEmbeddedMpvExtraOptions(
                'hwdec=auto\noops\nvo=null\nwid=1\nvo=gpu'
            )
        ).toEqual({ invalidLines: ['oops'], forbiddenKeys: ['vo', 'wid'] });
        expect(
            validateEmbeddedMpvExtraOptions('input-ipc-server=/tmp/s')
        ).toEqual({
            forbiddenKeys: ['input-ipc-server'],
        });
    });

    it('prepends the network defaults and drops forbidden keys for the addon', () => {
        expect(resolveEmbeddedMpvSessionOptionArguments('')).toEqual([
            ...EMBEDDED_MPV_NETWORK_DEFAULT_OPTIONS,
        ]);
        expect(
            resolveEmbeddedMpvSessionOptionArguments(
                'wid=42\nhwdec=no\nnetwork-timeout=3\nbroken line'
            )
        ).toEqual([
            ...EMBEDDED_MPV_NETWORK_DEFAULT_OPTIONS,
            'hwdec=no',
            'network-timeout=3',
        ]);
    });

    it('keeps the user override after the default it replaces', () => {
        const options =
            resolveEmbeddedMpvSessionOptionArguments('network-timeout=3');
        expect(options.indexOf('network-timeout=10')).toBeLessThan(
            options.indexOf('network-timeout=3')
        );
    });
});
