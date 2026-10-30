import type { MediaStorage } from 'vidstack';

/**
 * Stand-ins for the Vidstack custom elements. Component specs mock the
 * `vidstack/player*` registration imports with
 * {@link defineFakeVidstackElements}, so `document.createElement('media-player')`
 * yields these instead of the real Vidstack runtime.
 */
export class FakeMediaPlayerElement extends HTMLElement {
    src: unknown = null;
    storage: MediaStorage | null = null;
    streamType = 'unknown';
    autoPlay = false;
    playsInline = false;
    load = 'visible';
    keyDisabled = false;
    volume = 1;
    muted = false;
    paused = true;
    currentTime = 0;
    readonly state = {
        canSeek: false,
        canFullscreen: true,
        fullscreen: false,
    };
    readonly destroy = jest.fn();
    readonly play = jest.fn(() => Promise.resolve());
    readonly pause = jest.fn(() => Promise.resolve());
    readonly enterFullscreen = jest.fn(() => Promise.resolve());
    readonly exitFullscreen = jest.fn(() => Promise.resolve());

    /** Simulates Vidstack announcing its provider before setting it up. */
    announceProvider(provider: unknown): void {
        this.dispatchEvent(
            new CustomEvent('provider-change', { detail: provider })
        );
    }
}

export class FakeMediaVideoLayoutElement extends HTMLElement {
    menuContainer: HTMLElement | null = null;
    colorScheme = 'system';
}

class FakeMediaProviderElement extends HTMLElement {}

export function defineFakeVidstackElements(): void {
    if (!customElements.get('media-player')) {
        customElements.define('media-player', FakeMediaPlayerElement);
    }
    if (!customElements.get('media-provider')) {
        customElements.define('media-provider', FakeMediaProviderElement);
    }
    if (!customElements.get('media-video-layout')) {
        customElements.define(
            'media-video-layout',
            FakeMediaVideoLayoutElement
        );
    }
}
