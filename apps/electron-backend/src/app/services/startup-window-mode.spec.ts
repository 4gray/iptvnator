import {
    FULLSCREEN_LAUNCH_SWITCH,
    resolveStartupWindowMode,
} from './startup-window-mode';

describe('resolveStartupWindowMode', () => {
    it('is exposed as the bare switch name Electron parses from argv', () => {
        // app.commandLine.hasSwitch() takes the name without dashes.
        expect(FULLSCREEN_LAUNCH_SWITCH).toBe('fullscreen');
    });

    it('defaults to a normal window on a fresh profile', () => {
        expect(
            resolveStartupWindowMode({
                cliHasFullscreenSwitch: false,
                storedMode: undefined,
            })
        ).toBe('normal');
    });

    it.each(['normal', 'maximized', 'fullscreen'] as const)(
        'honours the stored %s mode',
        (storedMode) => {
            expect(
                resolveStartupWindowMode({
                    cliHasFullscreenSwitch: false,
                    storedMode,
                })
            ).toBe(storedMode);
        }
    );

    it.each(['kiosk', '', 1, true, null, {}])(
        'collapses a hand-edited config value %p to normal',
        (storedMode) => {
            expect(
                resolveStartupWindowMode({
                    cliHasFullscreenSwitch: false,
                    storedMode,
                })
            ).toBe('normal');
        }
    );

    it('lets the --fullscreen switch win over any stored mode', () => {
        expect(
            resolveStartupWindowMode({
                cliHasFullscreenSwitch: true,
                storedMode: 'maximized',
            })
        ).toBe('fullscreen');
    });
});
