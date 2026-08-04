import {
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
});
