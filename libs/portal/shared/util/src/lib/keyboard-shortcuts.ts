export type KeyboardShortcutGroupId =
    | 'global'
    | 'navigation'
    | 'playback'
    | 'dialogs';

export interface KeyboardShortcutDisplayItem {
    id: string;
    labelKey: string;
    keys: readonly string[];
}

export interface KeyboardShortcutDisplayGroup {
    id: KeyboardShortcutGroupId;
    labelKey: string;
    items: readonly KeyboardShortcutDisplayItem[];
}

interface PlatformShortcutChord {
    mac: string;
    other: string;
}

type KeyboardShortcutChord = string | PlatformShortcutChord;

export interface KeyboardShortcutDefinition {
    id: string;
    group: KeyboardShortcutGroupId;
    labelKey: string;
    keys: readonly KeyboardShortcutChord[];
    order: number;
    electronOnly?: boolean;
}

const GROUPS: readonly {
    id: KeyboardShortcutGroupId;
    labelKey: string;
}[] = [
    {
        id: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.GROUPS.GLOBAL',
    },
    {
        id: 'navigation',
        labelKey: 'WORKSPACE.SHORTCUTS.GROUPS.NAVIGATION',
    },
    {
        id: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.GROUPS.PLAYBACK',
    },
    {
        id: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.GROUPS.DIALOGS',
    },
];

const commandChord = (key: string): PlatformShortcutChord => ({
    mac: `Cmd+${key}`,
    other: `Ctrl+${key}`,
});

export const APP_KEYBOARD_SHORTCUTS: readonly KeyboardShortcutDefinition[] = [
    {
        id: 'open-keyboard-shortcuts',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.OPEN_KEYBOARD_SHORTCUTS',
        keys: ['?'],
        order: 0,
    },
    {
        id: 'open-command-palette',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.OPEN_COMMAND_PALETTE',
        keys: [commandChord('K')],
        order: 10,
    },
    {
        id: 'open-global-search',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.OPEN_GLOBAL_SEARCH',
        keys: [commandChord('F')],
        order: 20,
        electronOnly: true,
    },
    {
        id: 'open-recently-viewed',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.OPEN_RECENTLY_VIEWED',
        keys: [commandChord('R')],
        order: 30,
        electronOnly: true,
    },
    {
        id: 'submit-shell-search',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.SUBMIT_SHELL_SEARCH',
        keys: ['Enter'],
        order: 40,
    },
    {
        id: 'toggle-sidebar',
        group: 'navigation',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.TOGGLE_SIDEBAR',
        keys: [commandChord('B')],
        order: 10,
    },
    {
        id: 'm3u-channel-number',
        group: 'navigation',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.M3U_CHANNEL_NUMBER',
        keys: ['0-9'],
        order: 20,
    },
    {
        id: 'embedded-mpv-play-pause',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.PLAY_PAUSE',
        keys: ['Space', 'K'],
        order: 10,
    },
    {
        id: 'embedded-mpv-fullscreen',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.TOGGLE_FULLSCREEN',
        keys: ['F'],
        order: 20,
    },
    {
        id: 'embedded-mpv-seek',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.SEEK',
        keys: ['ArrowLeft', 'ArrowRight'],
        order: 30,
    },
    {
        id: 'adjust-volume',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.ADJUST_VOLUME',
        keys: ['ArrowUp', 'ArrowDown'],
        order: 40,
    },
    {
        id: 'mute-audio',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.MUTE_AUDIO',
        keys: ['M'],
        order: 50,
    },
    {
        id: 'close-player-popovers',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.CLOSE_PLAYER_POPOVERS',
        keys: ['Escape'],
        order: 60,
    },
    {
        id: 'command-palette-navigation',
        group: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.COMMAND_PALETTE_NAVIGATION',
        keys: ['ArrowUp', 'ArrowDown'],
        order: 10,
    },
    {
        id: 'command-palette-run',
        group: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.COMMAND_PALETTE_RUN',
        keys: ['Enter'],
        order: 20,
    },
    {
        id: 'close-dialogs',
        group: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.CLOSE_DIALOGS',
        keys: ['Escape'],
        order: 30,
    },
    {
        id: 'downloads-open-item',
        group: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.DOWNLOADS_OPEN_ITEM',
        keys: ['Enter', 'Space'],
        order: 40,
    },
];

export function getKeyboardShortcutGroups(options: {
    isMac: boolean;
    isElectron: boolean;
}): readonly KeyboardShortcutDisplayGroup[] {
    return GROUPS.map((group) => ({
        ...group,
        items: APP_KEYBOARD_SHORTCUTS.filter(
            (shortcut) =>
                shortcut.group === group.id &&
                (!shortcut.electronOnly || options.isElectron)
        )
            .sort((first, second) => first.order - second.order)
            .map((shortcut) => ({
                id: shortcut.id,
                labelKey: shortcut.labelKey,
                keys: shortcut.keys.map((key) =>
                    resolveShortcutKey(key, options.isMac)
                ),
            })),
    })).filter((group) => group.items.length > 0);
}

export function isKeyboardShortcutHelpTrigger(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return false;
    }

    return event.key === '?' || (event.key === '/' && event.shiftKey);
}

function resolveShortcutKey(
    key: KeyboardShortcutChord,
    isMac: boolean
): string {
    return typeof key === 'string' ? key : isMac ? key.mac : key.other;
}
