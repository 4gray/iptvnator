import { PROFILE_PIN, verifyProfilePin } from './profile-pin';
import { StorageRequestError } from './storage-route-errors';

/** Wrong PINs in a row before a profile is locked for a while. */
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 30_000;
/** A wrong PIN stops counting after this long. */
export const PIN_FAILURE_WINDOW_MS = 15 * 60_000;

/**
 * Checks profile PINs and locks a profile after too many wrong ones. Every
 * route that takes a PIN (unlock, changing or removing it, deleting the
 * profile) goes through here, so all of them count towards the same lock.
 */
export class ProfilePinAttempts {
    /**
     * `at`: wrong PINs that have been checked. `inflight`: PINs being
     * checked now. A PIN in flight is not a failure until it is found wrong,
     * so a correct one never counts. It only holds a place in the budget
     * while it runs, so overlapping guesses cannot all start from the same
     * count.
     */
    private readonly failures = new Map<
        string,
        { at: number[]; until: number; inflight: Set<Promise<void>> }
    >();

    constructor(
        private readonly now: () => number = Date.now,
        private readonly check: typeof verifyProfilePin = verifyProfilePin
    ) {}

    /**
     * Resolves when `pin` matches `stored`; throws `403 wrong_pin`, or
     * `429 pin_locked` while the profile is locked. When the checks still
     * running could use up the last attempts, a new check waits for them
     * instead of guessing alongside: if one was correct, the profile is
     * not locked and this one goes on. `stillCurrent` runs after the hash
     * check: a PIN that matched a hash replaced meanwhile counts as wrong.
     */
    async verify(
        id: string,
        pin: unknown,
        stored: string,
        stillCurrent: () => boolean = () => true
    ): Promise<void> {
        let state = this.failures.get(id);
        if (!state) {
            state = { at: [], until: 0, inflight: new Set() };
            this.failures.set(id, state);
        }
        for (;;) {
            const now = this.now();
            if (state.until > now) {
                throw new PinLockedError(Math.ceil((state.until - now) / 1000));
            }
            // A lockout that has run out starts the count again, and
            // failures older than the window no longer count.
            if (state.until) state.at = [];
            state.until = 0;
            state.at = state.at.filter(
                (time) => time > now - PIN_FAILURE_WINDOW_MS
            );
            if (state.at.length + state.inflight.size < MAX_PIN_FAILURES) break;
            if (!state.inflight.size) {
                throw new PinLockedError(1);
            }
            await Promise.allSettled([...state.inflight]);
        }
        // A wait may have outlived the entry that held its state.
        this.failures.set(id, state);
        const run = this.attempt(state, pin, stored, stillCurrent);
        state.inflight.add(run);
        try {
            await run;
        } finally {
            state.inflight.delete(run);
            this.forgetIfIdle(id, state);
        }
    }

    /** Ends a lockout, for a profile whose PIN was removed or deleted. */
    clear(id: string): void {
        const state = this.failures.get(id);
        if (!state) return;
        state.at = [];
        state.until = 0;
        this.forgetIfIdle(id, state);
    }

    private async attempt(
        state: { at: number[]; until: number },
        pin: unknown,
        stored: string,
        stillCurrent: () => boolean
    ): Promise<void> {
        let ok = false;
        try {
            ok =
                typeof pin === 'string' &&
                PROFILE_PIN.test(pin) &&
                (await this.check(pin, stored)) &&
                stillCurrent();
        } finally {
            if (ok) {
                state.at = [];
                state.until = 0;
            } else {
                state.at.push(this.now());
                if (state.at.length >= MAX_PIN_FAILURES) {
                    state.until = this.now() + PIN_LOCK_MS;
                }
            }
        }
        if (!ok) {
            throw new StorageRequestError(403, 'wrong_pin', 'Wrong PIN.');
        }
    }

    private forgetIfIdle(
        id: string,
        state: { at: number[]; until: number; inflight: Set<unknown> }
    ): void {
        if (!state.inflight.size && !state.at.length && !state.until) {
            this.failures.delete(id);
        }
    }
}

/** `429 pin_locked`, with the seconds until the lock ends. */
export class PinLockedError extends StorageRequestError {
    constructor(readonly retryAfterSeconds: number) {
        super(429, 'pin_locked', 'Too many wrong PINs. Try again shortly.');
    }
}
