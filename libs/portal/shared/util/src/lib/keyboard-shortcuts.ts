import type { ZoomLevelAction } from '@iptvnator/shared/interfaces';
import {
    APP_KEYBOARD_SHORTCUTS,
    KEYBOARD_SHORTCUT_GROUPS,
} from './keyboard-shortcut-definitions';
import type {
    KeyboardShortcutChord,
    KeyboardShortcutGroupId,
} from './keyboard-shortcut-definitions';

export { APP_KEYBOARD_SHORTCUTS };
export type { KeyboardShortcutGroupId };

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

const KEY_LABELS = new Map<string, string>([
    ['ArrowLeft', '←'],
    ['ArrowRight', '→'],
    ['ArrowUp', '↑'],
    ['ArrowDown', '↓'],
    ['Escape', 'Esc'],
    ['Plus', '+'],
    ['Minus', '−'],
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
    return KEYBOARD_SHORTCUT_GROUPS.map((group) => ({
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

/**
 * The app zoom shortcut `event` carries, or null. Follows the browser
 * convention on each platform — Cmd on macOS, Ctrl elsewhere, Alt never:
 * `+`/`=` (so `Ctrl+=` and `Ctrl+Shift+=` both zoom in), `-`/`_`, `0`, and
 * the numpad `+`/`-`/`0` keys (matched by `code`, since NumLock-off `0`
 * reports `Insert`). Keys are matched by `event.key` so non-US layouts zoom
 * with their own `+`/`-` keys rather than with whatever sits on `Equal`.
 */
export function resolveZoomShortcutAction(
    event: KeyboardEvent,
    options: { isMac: boolean }
): ZoomLevelAction | null {
    const commandModifier = options.isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;

    if (!commandModifier || event.altKey) {
        return null;
    }

    switch (event.key) {
        case '+':
        case '=':
            return 'in';
        case '-':
        case '_':
            return 'out';
        case '0':
            return 'reset';
    }

    switch (event.code) {
        case 'NumpadAdd':
            return 'in';
        case 'NumpadSubtract':
            return 'out';
        case 'Numpad0':
            return 'reset';
    }

    return null;
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
