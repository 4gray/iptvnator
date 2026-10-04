import { supportsNativeFloatingPlayer } from './playback-floating-policy';

describe('native floating-player capability', () => {
    it.each([
        ['win32', 'native', true, true],
        ['win32', 'native', false, false],
        ['win32', 'frame-copy', true, false],
        ['darwin', 'native', true, false],
        ['linux', 'native', true, false],
        [undefined, undefined, true, false],
    ] as const)(
        'gates %s/%s/reparent=%s',
        (platform, engine, reparent, expected) => {
            expect(
                supportsNativeFloatingPlayer(platform, engine, reparent)
            ).toBe(expected);
        }
    );
});
