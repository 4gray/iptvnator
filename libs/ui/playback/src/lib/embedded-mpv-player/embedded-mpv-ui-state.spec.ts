import {
    EmbeddedMpvFeedback,
    EmbeddedMpvMenuState,
} from './embedded-mpv-ui-state';

describe('EmbeddedMpvMenuState', () => {
    it('keeps only one menu open at a time', () => {
        const menus = new EmbeddedMpvMenuState();

        menus.open('volume');
        expect(menus.volumeOpen()).toBe(true);
        expect(menus.anyOpen()).toBe(true);

        menus.open('audio');
        expect(menus.volumeOpen()).toBe(false);
        expect(menus.audioOpen()).toBe(true);

        menus.toggle('audio');
        expect(menus.audioOpen()).toBe(false);
        expect(menus.anyOpen()).toBe(false);
    });
});

describe('EmbeddedMpvFeedback', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('flashes feedback and clears the previous timeout when replaced', () => {
        const feedback = new EmbeddedMpvFeedback();

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
        const feedback = new EmbeddedMpvFeedback();

        feedback.flash('volume_off', 'Muted', 700);
        feedback.dispose();
        jest.advanceTimersByTime(700);

        expect(feedback.current()?.label).toBe('Muted');
    });
});
