import { InjectionToken } from '@angular/core';

export type ParentalLockPromptMode = 'unlock' | 'set';

export interface ParentalLockPromptRequest {
    /** `unlock` asks for the current PIN, `set` asks for a new one twice. */
    mode: ParentalLockPromptMode;
    /**
     * Unlock only: resolves whether the typed PIN matches. The prompt keeps
     * asking on a mismatch and applies its own attempt cooldown.
     */
    verify?: (pin: string) => Promise<boolean>;
    /** Optional translation key overriding the mode's default title. */
    titleKey?: string;
    /** Optional translation key overriding the mode's default description. */
    descriptionKey?: string;
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
