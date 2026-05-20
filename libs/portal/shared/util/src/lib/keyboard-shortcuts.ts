export type KeyboardShortcutGroupId =
    | 'global'
    | 'navigation'
    | 'playback'
    | 'dialogs';

export interface KeyboardShortcutDisplayItem {
    id: string;
    labelKey: string;
    icon: string;
    chords: readonly KeyboardShortcutDisplayChord[];
}

export interface KeyboardShortcutDisplayChord {
    id: string;
    ariaLabel: string;
    keys: readonly KeyboardShortcutDisplayKey[];
}

export interface KeyboardShortcutDisplayKey {
    id: string;
    label: string;
    ariaLabel: string;
    isModifier: boolean;
}

export interface KeyboardShortcutDisplayGroup {
    id: KeyboardShortcutGroupId;
    labelKey: string;
    icon: string;
    items: readonly KeyboardShortcutDisplayItem[];
}

interface PlatformShortcutChord {
    mac: readonly string[];
    other: readonly string[];
}

type KeyboardShortcutChord = string | readonly string[] | PlatformShortcutChord;

export interface KeyboardShortcutDefinition {
    id: string;
    group: KeyboardShortcutGroupId;
    labelKey: string;
    icon: string;
    keys: readonly KeyboardShortcutChord[];
    order: number;
    electronOnly?: boolean;
}

const GROUPS: readonly {
    id: KeyboardShortcutGroupId;
    labelKey: string;
    icon: string;
}[] = [
    {
        id: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.GROUPS.GLOBAL',
        icon: 'keyboard',
    },
    {
        id: 'navigation',
        labelKey: 'WORKSPACE.SHORTCUTS.GROUPS.NAVIGATION',
        icon: 'explore',
    },
    {
        id: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.GROUPS.PLAYBACK',
        icon: 'play_circle',
    },
    {
        id: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.GROUPS.DIALOGS',
        icon: 'web_asset',
    },
];

const commandChord = (key: string): PlatformShortcutChord => ({
    mac: ['Cmd', key],
    other: ['Ctrl', key],
});

export const APP_KEYBOARD_SHORTCUTS: readonly KeyboardShortcutDefinition[] = [
    {
        id: 'open-keyboard-shortcuts',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.OPEN_KEYBOARD_SHORTCUTS',
        icon: 'help_outline',
        keys: ['?'],
        order: 0,
    },
    {
        id: 'open-command-palette',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.OPEN_COMMAND_PALETTE',
        icon: 'terminal',
        keys: [commandChord('K')],
        order: 10,
    },
    {
        id: 'open-global-search',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.OPEN_GLOBAL_SEARCH',
        icon: 'search',
        keys: [commandChord('F')],
        order: 20,
        electronOnly: true,
    },
    {
        id: 'open-recently-viewed',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.OPEN_RECENTLY_VIEWED',
        icon: 'history',
        keys: [commandChord('R')],
        order: 30,
        electronOnly: true,
    },
    {
        id: 'submit-shell-search',
        group: 'global',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.SUBMIT_SHELL_SEARCH',
        icon: 'keyboard_return',
        keys: ['Enter'],
        order: 40,
    },
    {
        id: 'toggle-sidebar',
        group: 'navigation',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.TOGGLE_SIDEBAR',
        icon: 'view_sidebar',
        keys: [commandChord('B')],
        order: 10,
    },
    {
        id: 'm3u-channel-number',
        group: 'navigation',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.M3U_CHANNEL_NUMBER',
        icon: 'dialpad',
        keys: ['0-9'],
        order: 20,
    },
    {
        id: 'embedded-mpv-play-pause',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.PLAY_PAUSE',
        icon: 'play_arrow',
        keys: ['Space', 'K'],
        order: 10,
        electronOnly: true,
    },
    {
        id: 'embedded-mpv-fullscreen',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.TOGGLE_FULLSCREEN',
        icon: 'fullscreen',
        keys: ['F'],
        order: 20,
        electronOnly: true,
    },
    {
        id: 'embedded-mpv-seek',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.SEEK',
        icon: 'swap_horiz',
        keys: ['ArrowLeft', 'ArrowRight'],
        order: 30,
        electronOnly: true,
    },
    {
        id: 'adjust-volume',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.ADJUST_VOLUME',
        icon: 'volume_up',
        keys: ['ArrowUp', 'ArrowDown'],
        order: 40,
    },
    {
        id: 'mute-audio',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.MUTE_AUDIO',
        icon: 'volume_off',
        keys: ['M'],
        order: 50,
    },
    {
        id: 'close-player-popovers',
        group: 'playback',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.CLOSE_PLAYER_POPOVERS',
        icon: 'close',
        keys: ['Escape'],
        order: 60,
        electronOnly: true,
    },
    {
        id: 'command-palette-navigation',
        group: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.COMMAND_PALETTE_NAVIGATION',
        icon: 'unfold_more',
        keys: ['ArrowUp', 'ArrowDown'],
        order: 10,
    },
    {
        id: 'command-palette-run',
        group: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.COMMAND_PALETTE_RUN',
        icon: 'subdirectory_arrow_right',
        keys: ['Enter'],
        order: 20,
    },
    {
        id: 'close-dialogs',
        group: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.CLOSE_DIALOGS',
        icon: 'close',
        keys: ['Escape'],
        order: 30,
    },
    {
        id: 'downloads-open-item',
        group: 'dialogs',
        labelKey: 'WORKSPACE.SHORTCUTS.ITEMS.DOWNLOADS_OPEN_ITEM',
        icon: 'download',
        keys: ['Enter', 'Space'],
        order: 40,
    },
];

const KEY_LABELS = new Map<string, string>([
    ['ArrowLeft', '←'],
    ['ArrowRight', '→'],
    ['ArrowUp', '↑'],
    ['ArrowDown', '↓'],
    ['Escape', 'Esc'],
]);

const KEY_ARIA_LABELS = new Map<string, string>([
    ['Cmd', 'Command'],
    ['Ctrl', 'Control'],
    ['ArrowLeft', 'Left arrow'],
    ['ArrowRight', 'Right arrow'],
    ['ArrowUp', 'Up arrow'],
    ['ArrowDown', 'Down arrow'],
    ['Escape', 'Escape'],
]);

const MODIFIER_KEYS = new Set(['Cmd', 'Ctrl', 'Alt', 'Shift']);

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
                icon: shortcut.icon,
                chords: shortcut.keys.map((key) =>
                    resolveShortcutChord(key, options.isMac)
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

function resolveShortcutChord(
    key: KeyboardShortcutChord,
    isMac: boolean
): KeyboardShortcutDisplayChord {
    const keys = resolveShortcutKeys(key, isMac);

    return {
        id: keys.join('+'),
        ariaLabel: keys
            .map(
                (shortcutKey) => KEY_ARIA_LABELS.get(shortcutKey) ?? shortcutKey
            )
            .join(' + '),
        keys: keys.map((shortcutKey) => ({
            id: shortcutKey.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            label: KEY_LABELS.get(shortcutKey) ?? shortcutKey,
            ariaLabel: KEY_ARIA_LABELS.get(shortcutKey) ?? shortcutKey,
            isModifier: MODIFIER_KEYS.has(shortcutKey),
        })),
    };
}

function resolveShortcutKeys(
    key: KeyboardShortcutChord,
    isMac: boolean
): readonly string[] {
    if (typeof key === 'string') {
        return [key];
    }

    if ('mac' in key) {
        return isMac ? key.mac : key.other;
    }

    return key;
}
