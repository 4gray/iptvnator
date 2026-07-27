import { ControlsVisibility } from './controls-visibility';

describe('ControlsVisibility', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('reveals and auto-hides when the canHide predicate allows it', () => {
        const visibility = new ControlsVisibility(() => true, 1000);

        visibility.reveal();
        expect(visibility.visible()).toBe(true);

        jest.advanceTimersByTime(1000);
        expect(visibility.visible()).toBe(false);
    });

    it('stays visible while canHide returns false', () => {
        const visibility = new ControlsVisibility(() => false, 1000);

        visibility.reveal();
        jest.advanceTimersByTime(1000);
        expect(visibility.visible()).toBe(true);
    });

    it('does not schedule a hide when reveal is called with scheduleHide:false', () => {
        const visibility = new ControlsVisibility(() => true, 1000);

        visibility.reveal({ scheduleHide: false });
        jest.advanceTimersByTime(1000);
        expect(visibility.visible()).toBe(true);
    });

    it('starts a full hide delay after leaving a pinned state', () => {
        let canHide = true;
        const visibility = new ControlsVisibility(() => canHide, 1000);

        visibility.reveal();
        jest.advanceTimersByTime(400);

        canHide = false;
        visibility.reveal({ scheduleHide: false });
        jest.advanceTimersByTime(100);

        canHide = true;
        visibility.scheduleHide();
        jest.advanceTimersByTime(999);
        expect(visibility.visible()).toBe(true);

        jest.advanceTimersByTime(1);
        expect(visibility.visible()).toBe(false);
    });

    it('clears a pending hide timer on dispose', () => {
        const visibility = new ControlsVisibility(() => true, 1000);

        visibility.reveal();
        visibility.dispose();
        jest.advanceTimersByTime(1000);
        expect(visibility.visible()).toBe(true);
    });
});
