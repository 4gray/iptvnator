import {
    ParentalLockPinThrottle,
    verifyParentalLockPin,
} from '@iptvnator/shared/interfaces';
import { ParentalLockPromptRequest } from './parental-lock-prompt.token';

type PromptLabels = Pick<
    ParentalLockPromptRequest,
    'titleKey' | 'descriptionKey' | 'submitKey'
>;

/**
 * The submit verb of each PIN flow, so the button says what it will do
 * instead of a generic "Unlock".
 */
export const PARENTAL_LOCK_SUBMIT_KEYS = {
    unlock: 'PARENTAL_LOCK.PIN_DIALOG.UNLOCK',
    save: 'PARENTAL_LOCK.PIN_DIALOG.SAVE',
    confirm: 'PARENTAL_LOCK.PIN_DIALOG.CONFIRM',
    turnOff: 'PARENTAL_LOCK.PIN_DIALOG.TURN_OFF',
} as const;

/** Setting up or replacing the PIN: typed twice, saved on submit. */
export const NEW_PIN_REQUEST: ParentalLockPromptRequest = {
    mode: 'set',
    submitKey: PARENTAL_LOCK_SUBMIT_KEYS.save,
};

/** Unlocks the session with the current PIN. */
export function unlockPinRequest(
    hash: string,
    throttle: ParentalLockPinThrottle,
    labels: Pick<PromptLabels, 'titleKey' | 'descriptionKey'> = {}
): ParentalLockPromptRequest {
    return currentPinRequest(hash, throttle, {
        submitKey: PARENTAL_LOCK_SUBMIT_KEYS.unlock,
        ...labels,
    });
}

/**
 * Confirms the current PIN before a protected settings change; `submitKey`
 * names that change (Confirm before a new PIN, Turn off).
 */
export function confirmPinRequest(
    hash: string,
    throttle: ParentalLockPinThrottle,
    submitKey: string
): ParentalLockPromptRequest {
    return currentPinRequest(hash, throttle, {
        titleKey: 'PARENTAL_LOCK.PIN_DIALOG.CONFIRM_TITLE',
        descriptionKey: 'PARENTAL_LOCK.PIN_DIALOG.CONFIRM_DESCRIPTION',
        submitKey,
    });
}

/**
 * Asks for the current PIN, checked against `hash`. Every such prompt shares
 * the service's `throttle`, so the cooldown survives a dismissed dialog.
 */
function currentPinRequest(
    hash: string,
    throttle: ParentalLockPinThrottle,
    labels: PromptLabels
): ParentalLockPromptRequest {
    return {
        mode: 'unlock',
        verify: (candidate) => verifyParentalLockPin(candidate, hash),
        throttle,
        ...labels,
    };
}
