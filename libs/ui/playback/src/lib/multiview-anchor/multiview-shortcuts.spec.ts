import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    MultiviewAnchorRegistry,
    MultiviewEntryService,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { ControlsShortcuts } from '../player-controls/controls-shortcuts';
import {
    handleMultiviewShortcut,
    installMultiviewShortcuts,
    type MultiviewShortcutDeps,
} from './multiview-shortcuts';

function press(
    key: string,
    init: KeyboardEventInit = {},
    target: EventTarget = document.body
): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
    });
    target.dispatchEvent(event);
    return event;
}

describe('multiview shortcuts', () => {
    let surface: HTMLElement;
    let session: boolean;
    let deps: MultiviewShortcutDeps & {
        entry: { pick: jest.Mock; canAdd: jest.Mock; hasPicker: boolean };
        store: { swap: jest.Mock; setAudio: jest.Mock };
    };

    beforeEach(() => {
        surface = document.createElement('div');
        document.body.appendChild(surface);
        session = false;
        deps = {
            entry: {
                hasPicker: true,
                canAdd: jest.fn(() => true),
                pick: jest.fn().mockResolvedValue(null),
            },
            store: {
                exists: () => session,
                anchorId: () => (session ? 'xtream-live' : null),
                activeTileId: () => (session ? 'multiview-tile-2' : null),
                swap: jest.fn(),
                setAudio: jest.fn(),
            },
            anchors: {
                current: () =>
                    ({ player: () => surface }) as unknown as ReturnType<
                        MultiviewShortcutDeps['anchors']['current']
                    >,
                find: () =>
                    ({ element: () => surface }) as unknown as ReturnType<
                        MultiviewShortcutDeps['anchors']['find']
                    >,
            },
        } as unknown as typeof deps;
    });

    afterEach(() => surface.remove());

    const event = (key: string, init: KeyboardEventInit = {}) =>
        new KeyboardEvent('keydown', { key, cancelable: true, ...init });

    it('opens the picker with Shift+M, with or without a session', () => {
        expect(
            handleMultiviewShortcut(event('M', { shiftKey: true }), deps)
        ).toBe(true);
        session = true;
        expect(
            handleMultiviewShortcut(event('M', { shiftKey: true }), deps)
        ).toBe(true);
        expect(deps.entry.pick).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['no picker exists', () => (deps.entry.hasPicker = false)],
        [
            'the view cannot start a session',
            () => deps.entry.canAdd.mockReturnValue(false),
        ],
        ['no player is on screen', () => surface.remove()],
        ['the player is inert', () => surface.setAttribute('inert', '')],
        [
            'a surface above owns the keyboard',
            () => surface.setAttribute('data-player-shortcuts-suspended', ''),
        ],
    ])('leaves Shift+M alone when %s', (_label, arrange) => {
        arrange();

        expect(
            handleMultiviewShortcut(event('M', { shiftKey: true }), deps)
        ).toBe(false);
        expect(deps.entry.pick).not.toHaveBeenCalled();
    });

    it.each([
        ['Ctrl', { ctrlKey: true }],
        ['Cmd', { metaKey: true }],
        ['Alt', { altKey: true }],
    ])('leaves %s chords alone', (_label, init) => {
        session = true;

        expect(handleMultiviewShortcut(event('s', init), deps)).toBe(false);
    });

    it('leaves keys typed into a control alone', () => {
        session = true;
        const input = document.createElement('input');
        document.body.appendChild(input);
        const listener = (e: Event) =>
            expect(handleMultiviewShortcut(e as KeyboardEvent, deps)).toBe(
                false
            );
        input.addEventListener('keydown', listener);
        press('s', {}, input);
        input.remove();

        expect(deps.store.swap).not.toHaveBeenCalled();
    });

    it('swaps with S and moves the sound with A during a session', () => {
        session = true;

        expect(handleMultiviewShortcut(event('s'), deps)).toBe(true);
        expect(handleMultiviewShortcut(event('A'), deps)).toBe(true);
        expect(deps.store.swap).toHaveBeenCalledTimes(1);
        expect(deps.store.setAudio).toHaveBeenCalledWith('multiview-tile-2');
    });

    it('leaves S, A, plain M and digits alone without a session', () => {
        for (const key of ['s', 'a', 'm', 'M', '1']) {
            expect(handleMultiviewShortcut(event(key), deps)).toBe(false);
        }
        session = true;
        expect(handleMultiviewShortcut(event('m'), deps)).toBe(false);
        expect(handleMultiviewShortcut(event('2'), deps)).toBe(false);
    });
});

describe('installMultiviewShortcuts with the player shortcuts', () => {
    @Component({ template: '' })
    class HostComponent {
        constructor() {
            installMultiviewShortcuts();
        }
    }

    let controls: ControlsShortcuts;
    let player: HTMLElement;
    const toggleMute = jest.fn();
    const pick = jest.fn().mockResolvedValue(null);

    function setup(hasPicker: boolean): void {
        player = document.createElement('div');
        document.body.appendChild(player);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: MultiviewEntryService,
                    useValue: { hasPicker, canAdd: () => true, pick },
                },
                {
                    provide: MultiviewSessionStore,
                    useValue: {
                        exists: signal(false),
                        anchorId: () => null,
                        activeTileId: () => null,
                    },
                },
                {
                    provide: MultiviewAnchorRegistry,
                    useValue: { current: () => ({ player: () => player }) },
                },
            ],
        });
        TestBed.createComponent(HostComponent);
        controls = new ControlsShortcuts();
        controls.attach({
            isAvailable: () => true,
            hostElement: () => player,
            canTogglePaused: () => true,
            canSeek: () => true,
            canAdjustVolume: () => true,
            canToggleFullscreen: () => true,
            onEscape: jest.fn(),
            togglePaused: jest.fn(),
            toggleFullscreen: jest.fn(),
            seekBy: jest.fn(),
            adjustVolume: jest.fn(),
            toggleMute,
        });
    }

    beforeEach(() => {
        toggleMute.mockClear();
        pick.mockClear();
    });

    afterEach(() => {
        controls.detach();
        player.remove();
    });

    it('opens the picker on Shift+M without muting', () => {
        setup(true);

        press('M', { shiftKey: true });

        expect(pick).toHaveBeenCalledTimes(1);
        expect(toggleMute).not.toHaveBeenCalled();
    });

    it('still mutes on M', () => {
        setup(true);

        press('m');

        expect(toggleMute).toHaveBeenCalledTimes(1);
        expect(pick).not.toHaveBeenCalled();
    });

    it('keeps Shift+M as mute where no picker exists', () => {
        setup(false);

        press('M', { shiftKey: true });

        expect(toggleMute).toHaveBeenCalledTimes(1);
        expect(pick).not.toHaveBeenCalled();
    });
});
