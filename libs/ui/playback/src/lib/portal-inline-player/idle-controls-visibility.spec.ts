import { IdleControlsVisibility } from './idle-controls-visibility';

describe('IdleControlsVisibility', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('starts visible', () => {
        const controls = new IdleControlsVisibility(3000);
        expect(controls.visible()).toBe(true);
    });

    it('hides after the idle delay with no activity', () => {
        const controls = new IdleControlsVisibility(3000);
        jest.advanceTimersByTime(3000);
        expect(controls.visible()).toBe(false);
    });

    it('stays visible while activity keeps arriving before the delay elapses', () => {
        const controls = new IdleControlsVisibility(3000);

        jest.advanceTimersByTime(2000);
        controls.notifyActivity();
        jest.advanceTimersByTime(2000);
        controls.notifyActivity();
        jest.advanceTimersByTime(2000);

        expect(controls.visible()).toBe(true);
    });

    it('reveals controls again once new activity arrives after hiding', () => {
        const controls = new IdleControlsVisibility(3000);

        jest.advanceTimersByTime(3000);
        expect(controls.visible()).toBe(false);

        controls.notifyActivity();
        expect(controls.visible()).toBe(true);
    });

    it('hides again after the delay following fresh activity', () => {
        const controls = new IdleControlsVisibility(3000);

        jest.advanceTimersByTime(3000);
        controls.notifyActivity();
        jest.advanceTimersByTime(2999);
        expect(controls.visible()).toBe(true);

        jest.advanceTimersByTime(1);
        expect(controls.visible()).toBe(false);
    });

    it('stops the pending timer once disposed', () => {
        const controls = new IdleControlsVisibility(3000);
        controls.dispose();

        jest.advanceTimersByTime(10000);

        // No pending timer should fire and throw/flip state after disposal.
        expect(controls.visible()).toBe(true);
    });
});
