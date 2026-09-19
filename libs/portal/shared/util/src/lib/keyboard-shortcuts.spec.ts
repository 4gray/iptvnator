import {
    APP_KEYBOARD_SHORTCUTS,
    getKeyboardShortcutGroups,
    isKeyboardShortcutHelpTrigger,
    resolveZoomShortcutAction,
} from './keyboard-shortcuts';

describe('keyboard shortcuts registry', () => {
    it('keeps shortcut ids unique', () => {
        const ids = APP_KEYBOARD_SHORTCUTS.map((shortcut) => shortcut.id);

        expect(new Set(ids).size).toBe(ids.length);
    });

    it('omits Electron-only shortcuts outside Electron', () => {
        const groups = getKeyboardShortcutGroups({
            isMac: false,
            isElectron: false,
        });
        const ids = groups.flatMap((group) =>
            group.items.map((item) => item.id)
        );

        expect(ids).not.toContain('open-global-search');
        expect(ids).not.toContain('open-recently-viewed');
        expect(ids).not.toContain('close-player-popovers');
        // The browser owns F11 in the PWA.
        expect(ids).not.toContain('toggle-window-fullscreen');
        // ...and its own zoom keys.
        expect(ids).not.toContain('zoom-in-out');
        expect(ids).not.toContain('reset-zoom');
        expect(ids).toContain('open-command-palette');
        // Playback shortcuts run in every runtime: the built-in web players
        // attach them through the legacy shortcut wiring in the PWA too.
        expect(ids).toContain('play-pause');
        expect(ids).toContain('toggle-fullscreen');
        expect(ids).toContain('seek');
        expect(ids).toContain('adjust-volume');
        expect(ids).toContain('mute-audio');
    });

    it('lists the F11 window fullscreen toggle in the global group for Electron', () => {
        const groups = getKeyboardShortcutGroups({
            isMac: false,
            isElectron: true,
        });
        const globalGroup = groups.find((group) => group.id === 'global');

        expect(globalGroup?.items.map((item) => item.id)).toContain(
            'toggle-window-fullscreen'
        );
        expect(findChordLabels(groups, 'toggle-window-fullscreen')).toEqual([
            ['F11'],
        ]);
    });

    it('lists the zoom shortcuts in the global group for Electron with platform modifiers', () => {
        const linuxGroups = getKeyboardShortcutGroups({
            isMac: false,
            isElectron: true,
        });
        const macGroups = getKeyboardShortcutGroups({
            isMac: true,
            isElectron: true,
        });

        expect(
            linuxGroups
                .find((group) => group.id === 'global')
                ?.items.map((item) => item.id)
        ).toEqual(expect.arrayContaining(['zoom-in-out', 'reset-zoom']));
        expect(findChordLabels(linuxGroups, 'zoom-in-out')).toEqual([
            ['Ctrl', '+'],
            ['Ctrl', '−'],
        ]);
        expect(findChordLabels(linuxGroups, 'reset-zoom')).toEqual([
            ['Ctrl', '0'],
        ]);
        expect(findChordLabels(macGroups, 'zoom-in-out')).toEqual([
            ['Cmd', '+'],
            ['Cmd', '−'],
        ]);
    });

    describe('resolveZoomShortcutAction', () => {
        const press = (init: KeyboardEventInit) =>
            new KeyboardEvent('keydown', init);
        const other = { isMac: false };
        const mac = { isMac: true };

        it('maps Ctrl and +/=/-/_/0 on Windows and Linux', () => {
            expect(
                resolveZoomShortcutAction(press({ key: '=', ctrlKey: true }), other)
            ).toBe('in');
            // Ctrl+Shift+= reports the shifted character.
            expect(
                resolveZoomShortcutAction(
                    press({ key: '+', ctrlKey: true, shiftKey: true }),
                    other
                )
            ).toBe('in');
            expect(
                resolveZoomShortcutAction(press({ key: '-', ctrlKey: true }), other)
            ).toBe('out');
            expect(
                resolveZoomShortcutAction(
                    press({ key: '_', ctrlKey: true, shiftKey: true }),
                    other
                )
            ).toBe('out');
            expect(
                resolveZoomShortcutAction(press({ key: '0', ctrlKey: true }), other)
            ).toBe('reset');
        });

        it('accepts the numpad keys, including NumLock-off 0', () => {
            expect(
                resolveZoomShortcutAction(
                    press({ key: '+', code: 'NumpadAdd', ctrlKey: true }),
                    other
                )
            ).toBe('in');
            expect(
                resolveZoomShortcutAction(
                    press({ key: '-', code: 'NumpadSubtract', ctrlKey: true }),
                    other
                )
            ).toBe('out');
            expect(
                resolveZoomShortcutAction(
                    press({ key: 'Insert', code: 'Numpad0', ctrlKey: true }),
                    other
                )
            ).toBe('reset');
        });

        it('uses Cmd on macOS and Ctrl elsewhere, never Alt', () => {
            expect(
                resolveZoomShortcutAction(press({ key: '=', metaKey: true }), mac)
            ).toBe('in');
            expect(
                resolveZoomShortcutAction(press({ key: '=', ctrlKey: true }), mac)
            ).toBeNull();
            expect(
                resolveZoomShortcutAction(press({ key: '=', metaKey: true }), other)
            ).toBeNull();
            expect(
                resolveZoomShortcutAction(
                    press({ key: '=', ctrlKey: true, altKey: true }),
                    other
                )
            ).toBeNull();
            expect(
                resolveZoomShortcutAction(
                    press({ key: '=', ctrlKey: true, metaKey: true }),
                    other
                )
            ).toBeNull();
        });

        it('ignores unmodified keys and unrelated combinations', () => {
            expect(resolveZoomShortcutAction(press({ key: '=' }), other)).toBeNull();
            expect(
                resolveZoomShortcutAction(press({ key: 'k', ctrlKey: true }), other)
            ).toBeNull();
            // Digit0 with Shift is ")" on US layouts — not a reset.
            expect(
                resolveZoomShortcutAction(
                    press({ key: ')', code: 'Digit0', ctrlKey: true, shiftKey: true }),
                    other
                )
            ).toBeNull();
        });
    });

    it('uses platform-specific modifier labels', () => {
        const macGroups = getKeyboardShortcutGroups({
            isMac: true,
            isElectron: true,
        });
        const linuxGroups = getKeyboardShortcutGroups({
            isMac: false,
            isElectron: true,
        });

        expect(findChordLabels(macGroups, 'open-command-palette')).toEqual([
            ['Cmd', 'K'],
        ]);
        expect(findChordLabels(linuxGroups, 'open-command-palette')).toEqual([
            ['Ctrl', 'K'],
        ]);
    });

    it('normalizes display labels for compact keycaps', () => {
        const groups = getKeyboardShortcutGroups({
            isMac: false,
            isElectron: true,
        });

        expect(findChordLabels(groups, 'seek')).toEqual([
            ['←'],
            ['→'],
        ]);
        expect(findChordLabels(groups, 'close-dialogs')).toEqual([['Esc']]);
    });

    it('detects the shortcuts help trigger', () => {
        expect(
            isKeyboardShortcutHelpTrigger(
                new KeyboardEvent('keydown', { key: '?' })
            )
        ).toBe(true);
        expect(
            isKeyboardShortcutHelpTrigger(
                new KeyboardEvent('keydown', { key: '/', shiftKey: true })
            )
        ).toBe(true);
        expect(
            isKeyboardShortcutHelpTrigger(
                new KeyboardEvent('keydown', { key: '/', ctrlKey: true })
            )
        ).toBe(false);
    });
});

function findChordLabels(
    groups: ReturnType<typeof getKeyboardShortcutGroups>,
    id: string
): readonly (readonly string[])[] {
    const item = groups
        .flatMap((group) => group.items)
        .find((shortcut) => shortcut.id === id);

    return (
        item?.chords.map((chord) => chord.keys.map((key) => key.label)) ?? []
    );
}
