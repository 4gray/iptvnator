import { AutoplayStreak } from './autoplay-streak.util';

describe('AutoplayStreak', () => {
    it('never stops autoplay without a limit', () => {
        const streak = new AutoplayStreak();
        for (let i = 0; i < 50; i++) {
            expect(streak.beginAutoplay()).toBe(true);
            streak.playbackStarted();
        }
        expect(streak.length).toBe(50);
    });

    it('counts autoplayed episodes and stops at the limit', () => {
        const streak = new AutoplayStreak(() => 2);
        expect(streak.beginAutoplay()).toBe(true);
        streak.playbackStarted();
        expect(streak.beginAutoplay()).toBe(true);
        streak.playbackStarted();
        expect(streak.length).toBe(2);
        expect(streak.canContinue()).toBe(false);
        expect(streak.beginAutoplay()).toBe(false);
        expect(streak.length).toBe(2);
    });

    it('resets when the viewer starts an episode', () => {
        const streak = new AutoplayStreak(() => 2);
        streak.beginAutoplay();
        streak.playbackStarted();
        streak.beginAutoplay();
        streak.playbackStarted();
        expect(streak.canContinue()).toBe(false);

        // No autoplay claimed this start: the viewer chose it.
        streak.playbackStarted();
        expect(streak.length).toBe(0);
        expect(streak.canContinue()).toBe(true);
    });

    it('releases a cancelled or failed start without losing completed episodes', () => {
        const streak = new AutoplayStreak();
        streak.beginAutoplay();
        streak.playbackStarted();
        streak.beginAutoplay();
        streak.cancelAutoplay();
        streak.cancelAutoplay();
        expect(streak.length).toBe(1);
        streak.playbackStarted();
        expect(streak.length).toBe(0);
    });

    it('reads the limit each time, so a setting change applies at once', () => {
        let limit: number | null = 1;
        const streak = new AutoplayStreak(() => limit);
        streak.beginAutoplay();
        streak.playbackStarted();
        expect(streak.canContinue()).toBe(false);
        limit = null;
        expect(streak.canContinue()).toBe(true);
    });

    it('starts a fresh run after the viewer confirms', () => {
        const streak = new AutoplayStreak(() => 1);
        streak.beginAutoplay();
        streak.reset();
        expect(streak.length).toBe(0);
        // The pending claim is gone too: the next start counts as the viewer's.
        streak.playbackStarted();
        expect(streak.length).toBe(0);
        expect(streak.beginAutoplay()).toBe(true);
    });
});
