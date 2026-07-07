import { ControlsFeedback } from './controls-feedback';

describe('ControlsFeedback', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('flashes feedback and clears the previous timeout when replaced', () => {
        const feedback = new ControlsFeedback();

        feedback.flash('volume_up', '60%', 700);
        expect(feedback.current()).toEqual({
            icon: 'volume_up',
            label: '60%',
            key: 1,
        });

        jest.advanceTimersByTime(500);
        feedback.flash('volume_down', '55%', 700);
        expect(feedback.current()).toEqual({
            icon: 'volume_down',
            label: '55%',
            key: 2,
        });

        jest.advanceTimersByTime(699);
        expect(feedback.current()?.label).toBe('55%');
        jest.advanceTimersByTime(1);
        expect(feedback.current()).toBeNull();
    });

    it('disposes pending feedback timers', () => {
        const feedback = new ControlsFeedback();

        feedback.flash('volume_off', 'Muted', 700);
        feedback.dispose();
        jest.advanceTimersByTime(700);

        expect(feedback.current()?.label).toBe('Muted');
    });
});
