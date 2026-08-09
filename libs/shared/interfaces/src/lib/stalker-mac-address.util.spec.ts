import {
    createStalkerMacAddressValidator,
    hasInfomirMacOui,
    INFOMIR_MAC_OUI,
    normalizeStalkerMacAddress,
    STALKER_MAC_ADDRESS_ERROR,
    validateStalkerMacAddressControl,
} from './stalker-mac-address.util';

describe('normalizeStalkerMacAddress', () => {
    it('upper-cases an already canonical address', () => {
        expect(normalizeStalkerMacAddress('00:1a:79:ab:cd:ef')).toBe(
            '00:1A:79:AB:CD:EF'
        );
    });

    it.each([
        ['hyphens', '00-1A-79-AB-CD-EF'],
        ['dots', '001a.79ab.cdef'],
        ['no separator', '001A79ABCDEF'],
        ['surrounding whitespace', '  00:1A:79:AB:CD:EF  '],
        ['embedded whitespace', '00 : 1A : 79 : AB : CD : EF'],
    ])('accepts %s', (_label, input) => {
        expect(normalizeStalkerMacAddress(input)).toBe('00:1A:79:AB:CD:EF');
    });

    it.each([
        ['too short', '00:1A:79:AB:CD'],
        ['too long', '00:1A:79:AB:CD:EF:01'],
        ['non-hex digits', '00:1A:79:AB:CD:GG'],
        ['empty', ''],
        ['separators only', '::::::'],
    ])('rejects %s', (_label, input) => {
        expect(normalizeStalkerMacAddress(input)).toBeNull();
    });

    it.each([[null], [undefined]])('rejects %p', (input) => {
        expect(normalizeStalkerMacAddress(input)).toBeNull();
    });
});

describe('hasInfomirMacOui', () => {
    it('accepts the Infomir range regardless of input formatting', () => {
        expect(hasInfomirMacOui('001a79abcdef')).toBe(true);
        expect(INFOMIR_MAC_OUI).toBe('00:1A:79');
    });

    it('reports a foreign OUI without rejecting the address', () => {
        expect(hasInfomirMacOui('00:1B:79:AB:CD:EF')).toBe(false);
        expect(normalizeStalkerMacAddress('00:1B:79:AB:CD:EF')).toBe(
            '00:1B:79:AB:CD:EF'
        );
    });

    it('is false for a malformed address', () => {
        expect(hasInfomirMacOui('00:1A:79')).toBe(false);
    });
});

describe('validateStalkerMacAddressControl', () => {
    it('passes a valid address', () => {
        expect(
            validateStalkerMacAddressControl({ value: '00-1a-79-ab-cd-ef' })
        ).toBeNull();
    });

    it('leaves emptiness to the required validator', () => {
        expect(validateStalkerMacAddressControl({ value: '' })).toBeNull();
        expect(validateStalkerMacAddressControl({ value: '   ' })).toBeNull();
        expect(validateStalkerMacAddressControl({ value: null })).toBeNull();
    });

    it('reports a malformed address', () => {
        expect(validateStalkerMacAddressControl({ value: 'not-a-mac' })).toEqual(
            { [STALKER_MAC_ADDRESS_ERROR]: true }
        );
    });

    it('accepts a MAC outside the Infomir range', () => {
        // The stock portal's OUI filter is off on most reseller panels, so a
        // non-Infomir MAC is a working configuration for a lot of users.
        // Refusing it here would stop them adding or editing a portal that
        // works today; `hasInfomirMacOui` only drives a hint.
        expect(
            validateStalkerMacAddressControl({ value: 'AA:BB:CC:DD:EE:01' })
        ).toBeNull();
        expect(hasInfomirMacOui('AA:BB:CC:DD:EE:01')).toBe(false);
    });
});

describe('createStalkerMacAddressValidator', () => {
    it('grandfathers the value a playlist already stored', () => {
        // A playlist saved before this validation existed may hold anything,
        // and on a panel that ignores the MAC it works. Marking the form
        // invalid on open would disable Save and strand the user's title, URL
        // and EPG edits over a field the portal may not even read.
        const validate = createStalkerMacAddressValidator('legacy-device-42');

        expect(validate({ value: 'legacy-device-42' })).toBeNull();
    });

    it('still refuses a newly typed malformed value', () => {
        const validate = createStalkerMacAddressValidator('legacy-device-42');

        expect(validate({ value: 'legacy-device-43' })).toEqual({
            [STALKER_MAC_ADDRESS_ERROR]: true,
        });
    });

    it('is the plain validator when there is nothing to grandfather', () => {
        expect(
            createStalkerMacAddressValidator(undefined)({ value: 'nope' })
        ).toEqual({ [STALKER_MAC_ADDRESS_ERROR]: true });
        expect(
            createStalkerMacAddressValidator(null)({
                value: '00:1A:79:AA:BB:CC',
            })
        ).toBeNull();
    });

    it('does not let an undefined exemption match an empty control', () => {
        // `control.value === grandfatheredValue` would be true for two
        // undefineds, which would exempt every untouched control.
        const validate = createStalkerMacAddressValidator(undefined);

        expect(validate({ value: undefined })).toBeNull();
        expect(validate({ value: 'not-a-mac' })).toEqual({
            [STALKER_MAC_ADDRESS_ERROR]: true,
        });
    });
});
