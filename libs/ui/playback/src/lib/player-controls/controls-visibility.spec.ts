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

    it('clears a pending hide timer on dispose', () => {
        const visibility = new ControlsVisibility(() => true, 1000);

        visibility.reveal();
        visibility.dispose();
        jest.advanceTimersByTime(1000);
        expect(visibility.visible()).toBe(true);
    });
});
