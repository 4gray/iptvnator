import { PROFILE_PIN, verifyProfilePin } from './profile-pin';
import { StorageRequestError } from './storage-route-errors';

/** Wrong PINs in a row before a profile is locked for a while. */
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 30_000;

/**
 * Checks profile PINs and locks a profile after too many wrong ones. Every
 * route that takes a PIN (unlock, changing or removing it, deleting the
 * profile) goes through here, so all of them count towards the same lock.
 */
export class ProfilePinAttempts {
    private readonly failures = new Map<
        string,
        { count: number; until: number }
    >();

    constructor(private readonly now: () => number = Date.now) {}

    /**
     * Resolves when `pin` matches `stored`; throws `403 wrong_pin`, or
     * `429 pin_locked` while the profile is locked.
     */
    async verify(id: string, pin: unknown, stored: string): Promise<void> {
        const now = this.now();
        const state = this.failures.get(id);
        if (state && state.until > now) {
            throw new PinLockedError(Math.ceil((state.until - now) / 1000));
        }
        // Every attempt counts before the PIN is checked, so overlapping
        // guesses cannot all start from the same count. A lockout that has
        // run out starts the count again.
        const expired = !!state?.until && state.until <= now;
        const count = (expired ? 0 : (state?.count ?? 0)) + 1;
        this.failures.set(id, {
            count,
            until: count >= MAX_PIN_FAILURES ? now + PIN_LOCK_MS : 0,
        });
        const ok =
            typeof pin === 'string' &&
            PROFILE_PIN.test(pin) &&
            (await verifyProfilePin(pin, stored));
        if (!ok) {
            throw new StorageRequestError(403, 'wrong_pin', 'Wrong PIN.');
        }
        this.failures.delete(id);
    }

    /** Ends a lockout, for a profile whose PIN was removed or deleted. */
    clear(id: string): void {
        this.failures.delete(id);
    }
}

/** `429 pin_locked`, with the seconds until the lock ends. */
export class PinLockedError extends StorageRequestError {
    constructor(readonly retryAfterSeconds: number) {
        super(429, 'pin_locked', 'Too many wrong PINs. Try again shortly.');
    }
}
