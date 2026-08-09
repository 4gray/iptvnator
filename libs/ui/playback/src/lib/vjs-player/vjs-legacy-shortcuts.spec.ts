import type { LegacyPlayerShortcuts } from '../player-controls';
import { attachVjsLegacyShortcuts } from './vjs-legacy-shortcuts';
import type { VideoJsPlayer } from './vjs-player.types';

describe('attachVjsLegacyShortcuts', () => {
    let shortcuts: LegacyPlayerShortcuts;
    let isLive: boolean;
    let mock: {
        pausedValue: boolean;
        mutedValue: boolean;
        volumeValue: number;
        currentTimeValue: number;
        durationValue: number;
        fullscreenValue: boolean;
        play: jest.Mock;
        pause: jest.Mock;
        requestFullscreen: jest.Mock;
        exitFullscreen: jest.Mock;
        player: VideoJsPlayer;
    };

    beforeEach(() => {
        isLive = false;
        mock = {
            pausedValue: true,
            mutedValue: false,
            volumeValue: 0.5,
            currentTimeValue: 100,
            durationValue: 600,
            fullscreenValue: false,
            play: jest.fn(() => Promise.resolve()),
            pause: jest.fn(),
            requestFullscreen: jest.fn(),
            exitFullscreen: jest.fn(),
            player: null as unknown as VideoJsPlayer,
        };
        mock.player = {
            paused: jest.fn(() => mock.pausedValue),
            play: mock.play,
            pause: mock.pause,
            muted: jest.fn((value?: boolean) => {
                if (value !== undefined) {
                    mock.mutedValue = value;
                }
                return mock.mutedValue;
            }),
            volume: jest.fn((value?: number) => {
                if (value !== undefined) {
                    mock.volumeValue = value;
                }
                return mock.volumeValue;
            }),
            currentTime: jest.fn((value?: number) => {
                if (value !== undefined) {
                    mock.currentTimeValue = value;
                }
                return mock.currentTimeValue;
            }),
            duration: jest.fn(() => mock.durationValue),
            isFullscreen: jest.fn(() => mock.fullscreenValue),
            requestFullscreen: mock.requestFullscreen,
            exitFullscreen: mock.exitFullscreen,
        } as unknown as VideoJsPlayer;
        shortcuts = attachVjsLegacyShortcuts({
            player: () => mock.player,
            hostElement: () => null,
            isAvailable: () => true,
            isLive: () => isLive,
        });
    });

    afterEach(() => {
        shortcuts.detach();
    });

    it('toggles play and pause with Space', () => {
        dispatchKey(' ');
        expect(mock.play).toHaveBeenCalledTimes(1);

        mock.pausedValue = false;
        dispatchKey(' ');
        expect(mock.pause).toHaveBeenCalledTimes(1);
    });

    it('seeks VOD by five seconds through the player API, clamped to bounds', () => {
        dispatchKey('ArrowRight');
        expect(mock.currentTimeValue).toBe(105);

        mock.currentTimeValue = 2;
        dispatchKey('ArrowLeft');
        expect(mock.currentTimeValue).toBe(0);

        mock.currentTimeValue = 598;
        dispatchKey('ArrowRight');
        expect(mock.currentTimeValue).toBe(600);
    });

    it('does not seek live playback or unknown durations', () => {
        isLive = true;
        expect(dispatchKey('ArrowRight')).toBe(false);

        isLive = false;
        mock.durationValue = NaN;
        expect(dispatchKey('ArrowRight')).toBe(false);
        expect(mock.currentTimeValue).toBe(100);
    });

    it('adjusts volume in five percent steps and syncs muted state', () => {
        dispatchKey('ArrowUp');
        expect(mock.volumeValue).toBeCloseTo(0.55);
        expect(mock.mutedValue).toBe(false);

        mock.volumeValue = 0.03;
        dispatchKey('ArrowDown');
        expect(mock.volumeValue).toBe(0);
        expect(mock.mutedValue).toBe(true);

        // Raising the volume out of the muted state unmutes.
        dispatchKey('ArrowUp');
        expect(mock.volumeValue).toBeCloseTo(0.05);
        expect(mock.mutedValue).toBe(false);
    });

    it('toggles mute with M', () => {
        dispatchKey('m');
        expect(mock.mutedValue).toBe(true);
        dispatchKey('m');
        expect(mock.mutedValue).toBe(false);
    });

    it('toggles the vendor fullscreen with F', () => {
        dispatchKey('f');
        expect(mock.requestFullscreen).toHaveBeenCalledTimes(1);

        mock.fullscreenValue = true;
        dispatchKey('f');
        expect(mock.exitFullscreen).toHaveBeenCalledTimes(1);
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
