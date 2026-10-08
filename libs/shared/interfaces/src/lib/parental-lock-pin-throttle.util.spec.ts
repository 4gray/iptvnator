import {
    createParentalLockPinThrottle,
    PARENTAL_LOCK_PIN_COOLDOWN_MS,
    PARENTAL_LOCK_PIN_MAX_ATTEMPTS,
} from './parental-lock-pin-throttle.util';

describe('createParentalLockPinThrottle', () => {
    it('starts a cooldown after the maximum failures and ends it on time', () => {
        let clock = 1_000;
        const throttle = createParentalLockPinThrottle(() => clock);
        for (let i = 1; i < PARENTAL_LOCK_PIN_MAX_ATTEMPTS; i++) {
            expect(throttle.recordFailure()).toBe(false);
        }
        expect(throttle.cooldownUntil()).toBe(0);

        expect(throttle.recordFailure()).toBe(true);
        expect(throttle.cooldownUntil()).toBe(
            1_000 + PARENTAL_LOCK_PIN_COOLDOWN_MS
        );

        clock += PARENTAL_LOCK_PIN_COOLDOWN_MS;
        expect(throttle.cooldownUntil()).toBe(0);
    });

    it('clears the count and the cooldown after the right PIN', () => {
        const throttle = createParentalLockPinThrottle(() => 0);
        for (let i = 1; i < PARENTAL_LOCK_PIN_MAX_ATTEMPTS; i++) {
            throttle.recordFailure();
        }
        throttle.recordSuccess();
        expect(throttle.recordFailure()).toBe(false);
        expect(throttle.cooldownUntil()).toBe(0);
    });
});
