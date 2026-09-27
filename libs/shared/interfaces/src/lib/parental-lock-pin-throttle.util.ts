/** Failed PIN attempts before the prompt pauses for the cooldown. */
export const PARENTAL_LOCK_PIN_MAX_ATTEMPTS = 5;
export const PARENTAL_LOCK_PIN_COOLDOWN_MS = 30_000;

/**
 * Wrong-PIN bookkeeping that outlives a single PIN dialog. Kept by the lock
 * service and handed to every unlock prompt, so dismissing the dialog during
 * a cooldown and opening it again neither resets the count nor the pause.
 */
export interface ParentalLockPinThrottle {
    /** Epoch milliseconds until which no PIN may be tried; 0 when none. */
    cooldownUntil(): number;
    /** Records a wrong PIN; true when this failure starts a cooldown. */
    recordFailure(): boolean;
    /** Clears the count after the right PIN. */
    recordSuccess(): void;
}

export function createParentalLockPinThrottle(
    now: () => number = Date.now
): ParentalLockPinThrottle {
    let failedAttempts = 0;
    let cooldownUntil = 0;
    return {
        cooldownUntil: () => (cooldownUntil > now() ? cooldownUntil : 0),
        recordFailure: () => {
            failedAttempts += 1;
            if (failedAttempts < PARENTAL_LOCK_PIN_MAX_ATTEMPTS) {
                return false;
            }
            failedAttempts = 0;
            cooldownUntil = now() + PARENTAL_LOCK_PIN_COOLDOWN_MS;
            return true;
        },
        recordSuccess: () => {
            failedAttempts = 0;
            cooldownUntil = 0;
        },
    };
}
