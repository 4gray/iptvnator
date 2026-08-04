/**
 * Infomir's OUI. The stock Stalker/Ministra MAC validator is enabled by
 * default and only accepts addresses in this range
 * (`/^00:1A:79:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}$/`). A MAC outside it is
 * refused with a bare `{status: 1}` and no explanation, which is
 * indistinguishable from a blocked account — hence the hint in the import UI.
 */
export const INFOMIR_MAC_OUI = '00:1A:79';

const MAC_SEPARATORS = /[\s:.-]/g;
const TWELVE_HEX_DIGITS = /^[0-9A-F]{12}$/;

/**
 * Canonicalizes a MAC address to the uppercase colon form a real STB sends
 * (`00:1A:79:12:34:56`), or returns `null` when the input is not a MAC.
 *
 * Accepts the shapes users actually paste — colons, hyphens, dots, embedded
 * whitespace, or no separator at all — because a portal that validates the
 * format answers a bare `{status: 1}`, and "your MAC has hyphens" is not a
 * diagnosis anyone can make from that.
 *
 * Note this is an INPUT-boundary helper. Stored MAC addresses are deliberately
 * not rewritten on read: the MAC is the account key, and silently changing the
 * bytes an already-working playlist puts on the wire is exactly the kind of
 * unattended identity change the Stalker pinning semantics punish. Normalizing
 * what the user types (and only that) keeps the change visible and reversible.
 */
export function normalizeStalkerMacAddress(
    value: string | null | undefined
): string | null {
    const digits = (value ?? '').replace(MAC_SEPARATORS, '').toUpperCase();

    if (!TWELVE_HEX_DIGITS.test(digits)) {
        return null;
    }

    return (digits.match(/.{2}/g) as string[]).join(':');
}

/**
 * True when the address sits in Infomir's OUI, i.e. the stock portal's default
 * MAC filter would accept it. A `false` verdict is a hint, never an error:
 * plenty of resellers disable the check, and refusing to import would lock
 * those users out of a portal that works.
 */
export function hasInfomirMacOui(value: string | null | undefined): boolean {
    const normalized = normalizeStalkerMacAddress(value);

    return normalized !== null && normalized.startsWith(`${INFOMIR_MAC_OUI}:`);
}

/** Error key an invalid MAC control reports. */
export const STALKER_MAC_ADDRESS_ERROR = 'stalkerMacAddress';

/**
 * Form validator for a Stalker MAC field, shared by the import dialog and the
 * playlist edit dialog so both accept exactly what `normalizeStalkerMacAddress`
 * accepts.
 *
 * Deliberately structural rather than typed as Angular's `ValidatorFn`: this
 * library is the contract layer the Electron main process imports, and it must
 * stay free of framework dependencies. `AbstractControl` satisfies
 * `{ value: unknown }`, so the function is assignable wherever a `ValidatorFn`
 * is expected.
 *
 * An empty control is left alone — requiredness is a separate concern.
 */
export function validateStalkerMacAddressControl(control: {
    value: unknown;
}): Record<typeof STALKER_MAC_ADDRESS_ERROR, true> | null {
    const value = control.value;

    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    return normalizeStalkerMacAddress(value)
        ? null
        : { [STALKER_MAC_ADDRESS_ERROR]: true };
}
