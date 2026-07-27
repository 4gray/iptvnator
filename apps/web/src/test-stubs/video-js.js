// The video.js CJS bundle fails to evaluate under the web project's ESM jest
// preset, so specs that transitively import the vjs player get this stub. It
// stays CommonJS because videojs plugin packages require() it at module load.
class StubComponent {
    createEl() {
        return {};
    }
}

class StubPlugin {}

class StubEventTarget {
    on() {
        return undefined;
    }
    off() {
        return undefined;
    }
    one() {
        return undefined;
    }
    trigger() {
        return undefined;
    }
}

const videoJs = () => ({
    dispose: () => undefined,
    on: () => undefined,
    off: () => undefined,
    src: () => undefined,
});

videoJs.getComponent = () => StubComponent;
videoJs.registerComponent = () => undefined;
videoJs.getPlugin = () => StubPlugin;
videoJs.registerPlugin = () => undefined;
videoJs.EventTarget = StubEventTarget;
videoJs.dom = { createEl: () => ({}) };
videoJs.browser = {};

module.exports = videoJs;
module.exports.default = videoJs;
