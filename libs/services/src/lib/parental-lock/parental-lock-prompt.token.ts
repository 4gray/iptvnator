import { InjectionToken } from '@angular/core';
import type { ParentalLockPinThrottle } from '@iptvnator/shared/interfaces';

export type ParentalLockPromptMode = 'unlock' | 'set';

export interface ParentalLockPromptRequest {
    /** `unlock` asks for the current PIN, `set` asks for a new one twice. */
    mode: ParentalLockPromptMode;
    /**
     * Unlock only: resolves whether the typed PIN matches. The prompt keeps
     * asking on a mismatch and applies its own attempt cooldown.
     */
    verify?: (pin: string) => Promise<boolean>;
    /**
     * Unlock only: the wrong-PIN count and cooldown, owned by the lock
     * service so they survive the prompt being dismissed and reopened.
     */
    throttle?: ParentalLockPinThrottle;
    /** Optional translation key overriding the mode's default title. */
    titleKey?: string;
    /** Optional translation key overriding the mode's default description. */
    descriptionKey?: string;
    /**
     * Translation key of the flow's verb on the submit button ("Unlock",
     * "Save PIN", "Turn off", …); the mode's default when absent.
     */
    submitKey?: string;
}

/**
 * The UI half of the parental lock: shows a PIN prompt and resolves with the
 * accepted PIN, or `null` when the user dismissed it.
 *
 * Provided by the application (which may depend on UI libraries) so the
 * lock service in this data-access library stays free of dialogs.
 */
export interface ParentalLockPrompt {
    requestPin(request: ParentalLockPromptRequest): Promise<string | null>;
}

export const PARENTAL_LOCK_PROMPT = new InjectionToken<ParentalLockPrompt>(
    'PARENTAL_LOCK_PROMPT'
);
