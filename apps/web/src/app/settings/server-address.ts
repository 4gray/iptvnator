import { FormControl, Validators } from '@angular/forms';
import { normalizeSourceServerUrl } from '@iptvnator/shared/interfaces/source-definition';

/** A saved API base may predate the /api suffix convention. */
export function matchesServerAddress(input: string, apiUrl?: string): boolean {
    if (!apiUrl) return false;
    const address = input.trim().replace(/\/+$/, '');
    try {
        return (
            address === apiUrl || normalizeSourceServerUrl(address) === apiUrl
        );
    } catch {
        return false;
    }
}

export function serverAddressControl(initial: string): FormControl<string> {
    return new FormControl(initial, {
        nonNullable: true,
        validators: [
            Validators.required,
            (control) => {
                try {
                    normalizeSourceServerUrl(control.value.trim());
                    return null;
                } catch {
                    return { serverUrl: true };
                }
            },
        ],
    });
}
