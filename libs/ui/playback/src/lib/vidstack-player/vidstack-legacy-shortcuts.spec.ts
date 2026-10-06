import type { MediaPlayerElement } from 'vidstack/elements';
import type { LegacyPlayerShortcuts } from '../player-controls';
import { attachVidstackLegacyShortcuts } from './vidstack-legacy-shortcuts';

interface MockVidstackPlayer {
    paused: boolean;
    muted: boolean;
    volume: number;
    currentTime: number;
    state: { canSeek: boolean; canFullscreen: boolean; fullscreen: boolean };
    play: jest.Mock;
    pause: jest.Mock;
    enterFullscreen: jest.Mock;
    exitFullscreen: jest.Mock;
}

describe('attachVidstackLegacyShortcuts', () => {
    let shortcuts: LegacyPlayerShortcuts;
    let isLive: boolean;
    let player: MockVidstackPlayer;

    beforeEach(() => {
        isLive = false;
        player = {
            paused: false,
            muted: false,
            volume: 0.5,
            currentTime: 100,
            state: { canSeek: true, canFullscreen: true, fullscreen: false },
            play: jest.fn(() => Promise.resolve()),
            pause: jest.fn(() => Promise.resolve()),
            enterFullscreen: jest.fn(() => Promise.resolve()),
            exitFullscreen: jest.fn(() => Promise.resolve()),
        };
        shortcuts = attachVidstackLegacyShortcuts({
            player: () => player as unknown as MediaPlayerElement,
            hostElement: () => null,
            isAvailable: () => true,
            isLive: () => isLive,
        });
    });

    afterEach(() => {
        shortcuts.detach();
    });

    it('toggles play and pause with Space through the Vidstack API', () => {
        dispatchKey(' ');
        expect(player.pause).toHaveBeenCalledTimes(1);

        player.paused = true;
        dispatchKey(' ');
        expect(player.play).toHaveBeenCalledTimes(1);
    });

    it('swallows rejected play requests', async () => {
        player.paused = true;
        player.play.mockReturnValue(Promise.reject(new Error('blocked')));

        dispatchKey(' ');
        await Promise.resolve();

        expect(player.play).toHaveBeenCalledTimes(1);
    });

    it('seeks by five seconds and never before the start', () => {
        dispatchKey('ArrowRight');
        expect(player.currentTime).toBe(105);

        player.currentTime = 2;
        dispatchKey('ArrowLeft');
        expect(player.currentTime).toBe(0);
    });

    it('does not seek live playback or media Vidstack cannot seek', () => {
        isLive = true;
        expect(dispatchKey('ArrowRight')).toBe(false);

        isLive = false;
        player.state.canSeek = false;
        expect(dispatchKey('ArrowRight')).toBe(false);
        expect(player.currentTime).toBe(100);
    });

    it('adjusts volume in five percent steps and syncs muted state', () => {
        dispatchKey('ArrowUp');
        expect(player.volume).toBeCloseTo(0.55);
        expect(player.muted).toBe(false);

        player.volume = 0.03;
        dispatchKey('ArrowDown');
        expect(player.volume).toBe(0);
        expect(player.muted).toBe(true);
    });

    it('restores the remembered volume when unmuting with M', () => {
        player.volume = 0.7;
        dispatchKey('m');
        expect(player.muted).toBe(true);

        dispatchKey('ArrowDown');
        expect(player.volume).toBe(0);

        dispatchKey('m');
        expect(player.muted).toBe(false);
        expect(player.volume).toBe(0.7);
    });

    it('toggles the player fullscreen with F', () => {
        dispatchKey('f');
        expect(player.enterFullscreen).toHaveBeenCalledTimes(1);

        player.state.fullscreen = true;
        dispatchKey('f');
        expect(player.exitFullscreen).toHaveBeenCalledTimes(1);
    });

    it('leaves F to other owners when Vidstack cannot fullscreen', () => {
        player.state.canFullscreen = false;

        expect(dispatchKey('f')).toBe(false);
        expect(player.enterFullscreen).not.toHaveBeenCalled();
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
