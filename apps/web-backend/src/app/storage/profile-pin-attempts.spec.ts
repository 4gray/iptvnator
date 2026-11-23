import { hashProfilePin } from './profile-pin';
import {
    PIN_FAILURE_WINDOW_MS,
    ProfilePinAttempts,
} from './profile-pin-attempts';

const ID = 'profile';
const MINUTE = 60_000;

/** Settles to the error code, or 'ok'. */
const outcome = (attempt: Promise<void>) =>
    attempt.then(
        () => 'ok',
        (error: { code: string }) => error.code
    );

describe('ProfilePinAttempts', () => {
    let stored: string;
    beforeAll(async () => {
        stored = await hashProfilePin('1234');
    });

    function withClock() {
        let now = 1_000_000;
        const attempts = new ProfilePinAttempts(() => now);
        return {
            attempts,
            advance: (ms: number) => (now += ms),
            guess: (pin: string) => outcome(attempts.verify(ID, pin, stored)),
        };
    }

    it('stops counting wrong PINs older than the window', async () => {
        const { advance, guess } = withClock();
        for (let i = 0; i < 4; i++)
            expect(await guess('0000')).toBe('wrong_pin');
        advance(PIN_FAILURE_WINDOW_MS + MINUTE);
        // The fifth wrong PIN is the only recent one, so no lock follows.
        expect(await guess('0000')).toBe('wrong_pin');
        expect(await guess('1234')).toBe('ok');
    });

    it('locks after five wrong PINs within the window', async () => {
        const { advance, guess } = withClock();
        for (let i = 0; i < 4; i++)
            expect(await guess('0000')).toBe('wrong_pin');
        advance(PIN_FAILURE_WINDOW_MS - MINUTE);
        expect(await guess('0000')).toBe('wrong_pin');
        expect(await guess('1234')).toBe('pin_locked');
        // The lock runs out after 30 seconds and the count starts again.
        advance(31_000);
        expect(await guess('1234')).toBe('ok');
    });

    it('keeps only the failures inside the window when some have aged out', async () => {
        const { advance, guess } = withClock();
        for (let i = 0; i < 3; i++)
            expect(await guess('0000')).toBe('wrong_pin');
        advance(10 * MINUTE);
        expect(await guess('0000')).toBe('wrong_pin');
        advance(6 * MINUTE);
        // The first three aged out; with the one at ten minutes these make
        // four recent failures, one short of the lock.
        expect(await guess('0000')).toBe('wrong_pin');
        expect(await guess('0000')).toBe('wrong_pin');
        expect(await guess('0000')).toBe('wrong_pin');
        expect(await guess('1234')).toBe('ok');
    });
});
