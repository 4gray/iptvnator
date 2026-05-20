import {
    APP_KEYBOARD_SHORTCUTS,
    getKeyboardShortcutGroups,
    isKeyboardShortcutHelpTrigger,
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
        expect(ids).not.toContain('embedded-mpv-play-pause');
        expect(ids).not.toContain('embedded-mpv-fullscreen');
        expect(ids).not.toContain('embedded-mpv-seek');
        expect(ids).not.toContain('close-player-popovers');
        expect(ids).toContain('open-command-palette');
        expect(ids).toContain('adjust-volume');
        expect(ids).toContain('mute-audio');
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

        expect(findChordLabels(groups, 'embedded-mpv-seek')).toEqual([
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
