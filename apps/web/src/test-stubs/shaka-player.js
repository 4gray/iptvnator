/**
 * CJS test stub for the lazily imported `shaka-player` module (the real
 * compiled bundle is huge and ESM-hostile under jest). Mirrors the surface in
 * libs/ui/playback/src/lib/shaka-engine/shaka-module.types.ts.
 *
 * Specs can inspect `shaka.__instances` / reset with `shaka.__reset()`.
 */
class MockShakaPlayer {
    constructor() {
        this.configureCalls = [];
        this.loadedUrls = [];
        this.attachedTo = null;
        this.destroyCount = 0;
        this.selectTextTrackCalls = [];
        this.listeners = new Map();
        shaka.__instances.push(this);
    }

    attach(mediaElement) {
        this.attachedTo = mediaElement;
        return Promise.resolve();
    }

    configure(config) {
        this.configureCalls.push(config);
        return true;
    }

    load(assetUri) {
        this.loadedUrls.push(assetUri);
        return Promise.resolve();
    }

    destroy() {
        this.destroyCount += 1;
        return Promise.resolve();
    }

    addEventListener(type, listener) {
        const set = this.listeners.get(type) || new Set();
        set.add(listener);
        this.listeners.set(type, set);
    }

    removeEventListener(type, listener) {
        const set = this.listeners.get(type);
        if (set) {
            set.delete(listener);
        }
    }

    dispatch(type, detail) {
        for (const listener of this.listeners.get(type) || []) {
            listener({ type, detail });
        }
    }

    getAudioTracks() {
        return [];
    }

    selectAudioTrack() {
        return undefined;
    }

    getTextTracks() {
        return [];
    }

    selectTextTrack(track) {
        this.selectTextTrackCalls.push(track);
    }

    isLive() {
        return false;
    }
}

MockShakaPlayer.isBrowserSupported = () => true;

const shaka = {
    Player: MockShakaPlayer,
    polyfill: {
        installAll() {
            return undefined;
        },
    },
    __instances: [],
    __reset() {
        shaka.__instances.length = 0;
    },
};

module.exports = shaka;
module.exports.default = shaka;
