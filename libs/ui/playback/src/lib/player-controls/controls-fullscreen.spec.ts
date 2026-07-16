import { ControlsFullscreen } from './controls-fullscreen';

describe('ControlsFullscreen', () => {
    let target: HTMLElement;
    let requestFullscreen: jest.Mock;
    let exitFullscreen: jest.Mock;
    let originalExit: typeof document.exitFullscreen;

    const setFullscreenElement = (element: Element | null) => {
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            value: element,
        });
    };

    beforeEach(() => {
        target = document.createElement('div');
        requestFullscreen = jest.fn().mockResolvedValue(undefined);
        exitFullscreen = jest.fn().mockResolvedValue(undefined);
        (target as HTMLElement & { requestFullscreen: jest.Mock }).requestFullscreen =
            requestFullscreen;
        originalExit = document.exitFullscreen;
        document.exitFullscreen = exitFullscreen;
        setFullscreenElement(null);
    });

    afterEach(() => {
        document.exitFullscreen = originalExit;
        setFullscreenElement(null);
    });

    it('reports capability based on the target and document support', () => {
        const fs = new ControlsFullscreen(() => target);
        expect(fs.canFullscreen()).toBe(true);
        fs.dispose();

        const noTarget = new ControlsFullscreen(() => null);
        expect(noTarget.canFullscreen()).toBe(false);
        noTarget.dispose();
    });

    it('requests fullscreen on the target when not already fullscreen', async () => {
        const fs = new ControlsFullscreen(() => target);
        await fs.toggle();
        expect(requestFullscreen).toHaveBeenCalledTimes(1);
        expect(exitFullscreen).not.toHaveBeenCalled();
        fs.dispose();
    });

    it('exits fullscreen when the target is already fullscreen', async () => {
        setFullscreenElement(target);
        const fs = new ControlsFullscreen(() => target);
        await fs.toggle();
        expect(exitFullscreen).toHaveBeenCalledTimes(1);
        expect(requestFullscreen).not.toHaveBeenCalled();
        fs.dispose();
    });

    it('tracks fullscreen state and invokes onChange on fullscreenchange', () => {
        const onChange = jest.fn();
        const fs = new ControlsFullscreen(() => target, onChange);

        setFullscreenElement(target);
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(fs.isFullscreen()).toBe(true);
        expect(onChange).toHaveBeenCalledTimes(1);

        setFullscreenElement(null);
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(fs.isFullscreen()).toBe(false);
        fs.dispose();
    });

    it('stops reacting to fullscreenchange after dispose', () => {
        const onChange = jest.fn();
        const fs = new ControlsFullscreen(() => target, onChange);
        fs.dispose();
        setFullscreenElement(target);
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(onChange).not.toHaveBeenCalled();
    });
});
