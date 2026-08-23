import {
    DEFAULT_SUBTITLE_STYLE,
    SUBTITLE_STYLE_STORAGE_KEY,
} from '../player-controls/subtitle-style';
import { EmbeddedMpvSubtitleSettings } from './embedded-mpv-subtitle-settings';
import type { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

function createControllerMock() {
    return {
        addExternalSubtitle: jest.fn().mockResolvedValue(true),
        setSubtitleDelay: jest.fn().mockResolvedValue(undefined),
        setSubtitleStyle: jest.fn().mockResolvedValue(undefined),
    };
}

describe('EmbeddedMpvSubtitleSettings', () => {
    let controller: ReturnType<typeof createControllerMock>;

    function createSettings(): EmbeddedMpvSubtitleSettings {
        return new EmbeddedMpvSubtitleSettings(
            controller as unknown as EmbeddedMpvSessionController
        );
    }

    beforeEach(() => {
        controller = createControllerMock();
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('starts with the stored style and a zero delay', () => {
        localStorage.setItem(
            SUBTITLE_STYLE_STORAGE_KEY,
            JSON.stringify({ sizePercent: 150, color: '#ffffff' })
        );
        const settings = createSettings();
        expect(settings.style()).toEqual({
            sizePercent: 150,
            color: '#ffffff',
        });
        expect(settings.delaySeconds()).toBe(0);
    });

    it('clamps and forwards the delay to the session controller', () => {
        const settings = createSettings();
        settings.setDelay(90);
        expect(settings.delaySeconds()).toBe(60);
        expect(controller.setSubtitleDelay).toHaveBeenCalledWith(60);
    });

    it('normalizes, persists, and forwards style changes', () => {
        const settings = createSettings();
        settings.setStyle({ sizePercent: 125, color: '#FFE94F' });

        expect(settings.style()).toEqual({
            sizePercent: 125,
            color: '#ffe94f',
        });
        expect(controller.setSubtitleStyle).toHaveBeenCalledWith({
            sizePercent: 125,
            color: '#ffe94f',
        });
        expect(
            JSON.parse(localStorage.getItem(SUBTITLE_STYLE_STORAGE_KEY) ?? '')
        ).toEqual({ sizePercent: 125, color: '#ffe94f' });
    });

    it('resets the delay per session and re-applies a non-default style', () => {
        const settings = createSettings();
        settings.syncSession('session-1');
        // Default style: nothing pushed to a fresh session.
        expect(controller.setSubtitleStyle).not.toHaveBeenCalled();

        settings.setStyle({ sizePercent: 200, color: null });
        settings.setDelay(2);
        controller.setSubtitleStyle.mockClear();

        settings.syncSession('session-2');
        expect(settings.delaySeconds()).toBe(0);
        expect(controller.setSubtitleStyle).toHaveBeenCalledWith({
            sizePercent: 200,
            color: null,
        });

        // Re-observing the same session must not re-apply or reset anything.
        settings.setDelay(1.5);
        controller.setSubtitleStyle.mockClear();
        settings.syncSession('session-2');
        expect(settings.delaySeconds()).toBe(1.5);
        expect(controller.setSubtitleStyle).not.toHaveBeenCalled();
    });

    it('does not push the style while no session is active', () => {
        const settings = createSettings();
        settings.setStyle({ sizePercent: 150, color: null });
        controller.setSubtitleStyle.mockClear();
        settings.syncSession(null);
        expect(controller.setSubtitleStyle).not.toHaveBeenCalled();
        expect(settings.style()).not.toEqual(DEFAULT_SUBTITLE_STYLE);
    });
});
