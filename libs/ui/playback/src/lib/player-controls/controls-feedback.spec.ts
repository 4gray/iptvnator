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

    it('uses caller-provided recording transition labels', () => {
        const feedback = new ControlsFeedback();
        const labels = {
            active: 'Aufnahme',
            inactive: 'Aufnahme gespeichert',
        };

        feedback.flashRecordingTransition(true, labels);
        expect(feedback.current()?.label).toBe('Aufnahme');

        feedback.flashRecordingTransition(false, labels);
        expect(feedback.current()?.label).toBe('Aufnahme gespeichert');
    });

    it('clears only recording-owned feedback across owner handoff', () => {
        const feedback = new ControlsFeedback();
        const labels = {
            active: 'Recording',
            inactive: 'Recording saved',
        };

        feedback.flashRecordingTransition(true, labels, 'session-1');
        feedback.flashRecordingTransition(false, labels, 'session-2');
        expect(feedback.current()).toBeNull();

        feedback.flash('volume_up', '60%');
        feedback.flashRecordingTransition(false, labels, 'session-3');
        expect(feedback.current()?.label).toBe('60%');
    });
});
