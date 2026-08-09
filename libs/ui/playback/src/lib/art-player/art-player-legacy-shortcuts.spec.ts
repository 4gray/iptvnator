import type Artplayer from 'artplayer';
import type { LegacyPlayerShortcuts } from '../player-controls';
import { attachArtPlayerLegacyShortcuts } from './art-player-legacy-shortcuts';

interface MockArt {
    muted: boolean;
    volume: number;
    currentTime: number;
    duration: number;
    fullscreen: boolean;
    fullscreenWeb: boolean;
    forward: number | null;
    backward: number | null;
    toggle: jest.Mock;
}

describe('attachArtPlayerLegacyShortcuts', () => {
    let shortcuts: LegacyPlayerShortcuts;
    let isLive: boolean;
    let art: MockArt;

    beforeEach(() => {
        isLive = false;
        art = {
            muted: false,
            volume: 0.5,
            currentTime: 100,
            duration: 600,
            fullscreen: false,
            fullscreenWeb: false,
            forward: null,
            backward: null,
            toggle: jest.fn(),
        };
        shortcuts = attachArtPlayerLegacyShortcuts({
            player: () => art as unknown as Artplayer,
            hostElement: () => null,
            isAvailable: () => true,
            isLive: () => isLive,
        });
    });

    afterEach(() => {
        shortcuts.detach();
    });

    it('toggles play and pause with Space through the ArtPlayer API', () => {
        dispatchKey(' ');
        expect(art.toggle).toHaveBeenCalledTimes(1);
    });

    it('seeks through the vendor forward and backward setters', () => {
        dispatchKey('ArrowRight');
        expect(art.forward).toBe(5);

        dispatchKey('ArrowLeft');
        expect(art.backward).toBe(5);
    });

    it('does not seek live playback or unknown durations', () => {
        isLive = true;
        expect(dispatchKey('ArrowRight')).toBe(false);

        isLive = false;
        art.duration = 0;
        expect(dispatchKey('ArrowRight')).toBe(false);
        expect(art.forward).toBeNull();
    });

    it('adjusts volume in five percent steps and syncs muted state', () => {
        dispatchKey('ArrowUp');
        expect(art.volume).toBeCloseTo(0.55);
        expect(art.muted).toBe(false);

        art.volume = 0.03;
        dispatchKey('ArrowDown');
        expect(art.volume).toBe(0);
        expect(art.muted).toBe(true);

        dispatchKey('ArrowUp');
        expect(art.volume).toBeCloseTo(0.05);
        expect(art.muted).toBe(false);
    });

    it('toggles mute with M', () => {
        dispatchKey('m');
        expect(art.muted).toBe(true);
        dispatchKey('m');
        expect(art.muted).toBe(false);
    });

    it('toggles the vendor fullscreen with F', () => {
        dispatchKey('f');
        expect(art.fullscreen).toBe(true);
        dispatchKey('f');
        expect(art.fullscreen).toBe(false);
    });

    it('exits web fullscreen on Escape, mirroring the disabled vendor hotkey', () => {
        dispatchKey('Escape');
        expect(art.fullscreenWeb).toBe(false);

        art.fullscreenWeb = true;
        dispatchKey('Escape');
        expect(art.fullscreenWeb).toBe(false);
    });
});

function dispatchKey(key: string): boolean {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
}
