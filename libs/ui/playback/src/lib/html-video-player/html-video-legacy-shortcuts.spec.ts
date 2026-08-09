import type { LegacyPlayerShortcuts } from '../player-controls';
import { attachHtmlVideoLegacyShortcuts } from './html-video-legacy-shortcuts';

describe('attachHtmlVideoLegacyShortcuts', () => {
    let shortcuts: LegacyPlayerShortcuts;
    let video: HTMLVideoElement;
    let isLive: boolean;
    let paused: boolean;
    let duration: number;
    let play: jest.Mock;
    let pause: jest.Mock;

    beforeEach(() => {
        isLive = false;
        paused = true;
        duration = 600;
        play = jest.fn();
        pause = jest.fn();
        video = document.createElement('video');
        Object.defineProperty(video, 'paused', { get: () => paused });
        Object.defineProperty(video, 'duration', { get: () => duration });
        video.pause = pause;
        video.volume = 0.5;
        video.currentTime = 100;
        shortcuts = attachHtmlVideoLegacyShortcuts({
            video: () => video,
            hostElement: () => null,
            isAvailable: () => true,
            isLive: () => isLive,
            play,
        });
    });

    afterEach(() => {
        shortcuts.detach();
    });

    it('plays through the session callback and pauses the element with Space', () => {
        dispatchKey(' ');
        expect(play).toHaveBeenCalledTimes(1);

        paused = false;
        dispatchKey(' ');
        expect(pause).toHaveBeenCalledTimes(1);
    });

    it('seeks by five seconds, clamped to the media bounds', () => {
        dispatchKey('ArrowRight');
        expect(video.currentTime).toBe(105);

        video.currentTime = 2;
        dispatchKey('ArrowLeft');
        expect(video.currentTime).toBe(0);

        video.currentTime = 598;
        dispatchKey('ArrowRight');
        expect(video.currentTime).toBe(600);
    });

    it('does not seek live playback or unknown durations', () => {
        isLive = true;
        expect(dispatchKey('ArrowRight')).toBe(false);

        isLive = false;
        duration = NaN;
        expect(dispatchKey('ArrowRight')).toBe(false);
        expect(video.currentTime).toBe(100);
    });

    it('adjusts volume in five percent steps and syncs muted state', () => {
        dispatchKey('ArrowUp');
        expect(video.volume).toBeCloseTo(0.55);
        expect(video.muted).toBe(false);

        video.volume = 0.03;
        dispatchKey('ArrowDown');
        expect(video.volume).toBe(0);
        expect(video.muted).toBe(true);

        dispatchKey('ArrowUp');
        expect(video.volume).toBeCloseTo(0.05);
        expect(video.muted).toBe(false);
    });

    it('toggles mute with M', () => {
        dispatchKey('m');
        expect(video.muted).toBe(true);
        dispatchKey('m');
        expect(video.muted).toBe(false);
    });

    it('fullscreens the video element itself with F', () => {
        const requestFullscreen = jest.fn(() => Promise.resolve());
        (
            video as HTMLVideoElement & { requestFullscreen: jest.Mock }
        ).requestFullscreen = requestFullscreen;

        dispatchKey('f');

        expect(requestFullscreen).toHaveBeenCalledTimes(1);
    });

    it('does not offer fullscreen when the element cannot enter it', () => {
        // jsdom video elements have no requestFullscreen implementation.
        expect(dispatchKey('f')).toBe(false);
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
