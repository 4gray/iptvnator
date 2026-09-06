import {
    EpgGuideKeyboardController,
    EpgGuideKeyboardHost,
} from './epg-guide-keyboard.controller';

function key(
    keyName: string,
    init: Partial<KeyboardEventInit> & { target?: EventTarget } = {}
): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: keyName, ...init });
    if (init.target) {
        Object.defineProperty(event, 'target', { value: init.target });
    }
    return event;
}

describe('EpgGuideKeyboardController', () => {
    let host: jest.Mocked<EpgGuideKeyboardHost>;
    let controller: EpgGuideKeyboardController;

    beforeEach(() => {
        host = {
            rowCount: jest.fn(() => 5),
            blockCount: jest.fn(() => 3),
            activeRow: jest.fn(() => 2),
            isBlocked: jest.fn(() => false),
            play: jest.fn(),
            details: jest.fn(),
            jumpNow: jest.fn(),
            stepDay: jest.fn(),
            close: jest.fn(),
        };
        controller = new EpgGuideKeyboardController(host);
    });

    it('starts row focus from the active channel and clamps at the ends', () => {
        expect(controller.handle(key('ArrowDown'))).toBe(true);
        expect(controller.focus()).toEqual({ row: 3, block: null });
        controller.handle(key('ArrowDown'));
        controller.handle(key('ArrowDown'));
        controller.handle(key('ArrowDown'));
        expect(controller.focus()).toEqual({ row: 4, block: null });
        host.activeRow.mockReturnValue(-1);
        controller.focus.set(null);
        controller.handle(key('ArrowUp'));
        expect(controller.focus()).toEqual({ row: 4, block: null });
    });

    it('moves block focus inside the focused row', () => {
        controller.handle(key('ArrowRight'));
        expect(controller.focus()).toEqual({ row: 2, block: 0 });
        controller.handle(key('ArrowRight'));
        controller.handle(key('ArrowRight'));
        controller.handle(key('ArrowRight'));
        expect(controller.focus()).toEqual({ row: 2, block: 2 });
        controller.handle(key('ArrowLeft'));
        expect(controller.focus()).toEqual({ row: 2, block: 1 });
        controller.handle(key('ArrowDown'));
        expect(controller.focus()).toEqual({ row: 3, block: null });
    });

    it('plays the focused (or active) row on Enter and opens details with I', () => {
        controller.handle(key('Enter'));
        expect(host.play).toHaveBeenCalledWith(2);
        controller.handle(key('ArrowDown'));
        controller.handle(key('ArrowRight'));
        controller.handle(key('i'));
        expect(host.details).toHaveBeenCalledWith(3, 0);
        controller.handle(key('Enter'));
        expect(host.play).toHaveBeenLastCalledWith(3);
    });

    it('maps N, PageUp/PageDown and Escape', () => {
        controller.handle(key('n'));
        expect(host.jumpNow).toHaveBeenCalled();
        controller.handle(key('PageUp'));
        expect(host.stepDay).toHaveBeenCalledWith('prev');
        controller.handle(key('PageDown'));
        expect(host.stepDay).toHaveBeenCalledWith('next');
        expect(controller.handle(key('Escape'))).toBe(true);
        expect(host.close).toHaveBeenCalled();
    });

    it('ignores typing, modifier chords, blocked state and unknown keys', () => {
        const input = document.createElement('input');
        expect(controller.handle(key('ArrowDown', { target: input }))).toBe(false);
        expect(controller.handle(key('ArrowDown', { ctrlKey: true }))).toBe(false);
        host.isBlocked.mockReturnValue(true);
        expect(controller.handle(key('Escape'))).toBe(false);
        host.isBlocked.mockReturnValue(false);
        expect(controller.handle(key('x'))).toBe(false);
        expect(host.close).not.toHaveBeenCalled();
    });
});
