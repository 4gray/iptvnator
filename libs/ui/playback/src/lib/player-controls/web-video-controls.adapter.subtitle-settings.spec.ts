import { DEFAULT_SUBTITLE_STYLE } from './subtitle-style';
import { WebVideoControlsAdapter } from './web-video-controls.adapter';

function createVideo(): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperties(video, {
        duration: { configurable: true, value: 120 },
        readyState: { configurable: true, value: 4 },
        networkState: { configurable: true, value: 1 },
        paused: { configurable: true, value: true },
        seekable: { configurable: true, value: { length: 1 } },
    });
    return video;
}

describe('WebVideoControlsAdapter subtitle settings', () => {
    let adapter: WebVideoControlsAdapter;
    let video: HTMLVideoElement;

    beforeEach(() => {
        adapter = new WebVideoControlsAdapter();
        video = createVideo();
    });

    afterEach(() => {
        adapter.detach();
    });

    it('advertises no subtitle-settings capability without the options', () => {
        adapter.attach(video, {});
        const capabilities = adapter.capabilities();
        expect(capabilities.externalSubtitles).toBe(false);
        expect(capabilities.subtitleDelay).toBe(false);
        expect(capabilities.subtitleStyle).toBe(false);
        expect(adapter.state().subtitleDelaySeconds).toBe(0);
        expect(adapter.state().subtitleStyle).toEqual(DEFAULT_SUBTITLE_STYLE);
    });

    it('derives the capabilities from the injected options', () => {
        const canAdjustSubtitleDelay = jest.fn().mockReturnValue(false);
        adapter.attach(video, {
            addExternalSubtitleFile: jest.fn(),
            setSubtitleDelay: jest.fn(),
            canAdjustSubtitleDelay,
            setSubtitleStyle: jest.fn(),
        });

        expect(adapter.capabilities().externalSubtitles).toBe(true);
        expect(adapter.capabilities().subtitleStyle).toBe(true);
        // The runtime gate keeps delay off until a file is loaded.
        expect(adapter.capabilities().subtitleDelay).toBe(false);

        canAdjustSubtitleDelay.mockReturnValue(true);
        adapter.refresh();
        expect(adapter.capabilities().subtitleDelay).toBe(true);
    });

    it('projects delay and style state from the engine getters', () => {
        adapter.attach(video, {
            getSubtitleDelay: () => 1.5,
            getSubtitleStyle: () => ({ sizePercent: 150, color: '#ffffff' }),
        });

        expect(adapter.state().subtitleDelaySeconds).toBe(1.5);
        expect(adapter.state().subtitleStyle).toEqual({
            sizePercent: 150,
            color: '#ffffff',
        });
    });

    it('delegates the commands and refreshes after synchronous setters', () => {
        const addExternalSubtitleFile = jest.fn();
        const setSubtitleDelay = jest.fn();
        const setSubtitleStyle = jest.fn();
        const getSubtitleDelay = jest.fn().mockReturnValue(0);
        adapter.attach(video, {
            addExternalSubtitleFile,
            getSubtitleDelay,
            setSubtitleDelay,
            setSubtitleStyle,
        });

        adapter.commands.addExternalSubtitleFile();
        expect(addExternalSubtitleFile).toHaveBeenCalledTimes(1);

        getSubtitleDelay.mockReturnValue(2);
        adapter.commands.setSubtitleDelay(2);
        expect(setSubtitleDelay).toHaveBeenCalledWith(2);
        expect(adapter.state().subtitleDelaySeconds).toBe(2);

        adapter.commands.setSubtitleStyle({ sizePercent: 125, color: null });
        expect(setSubtitleStyle).toHaveBeenCalledWith({
            sizePercent: 125,
            color: null,
        });
    });

    it('contains a throwing picker without breaking the command surface', () => {
        adapter.attach(video, {
            addExternalSubtitleFile: () => {
                throw new Error('no dialog');
            },
        });

        expect(() => adapter.commands.addExternalSubtitleFile()).not.toThrow();
    });
});
