import {
    asStalkerPortalError,
    combineStalkerPortalMessages,
    isStalkerDeviceConflictMessage,
    StalkerPortalError,
    stripStalkerPortalMarkup,
} from './stalker-portal-error';

describe('stripStalkerPortalMarkup', () => {
    it('strips the markup a real block_msg carries', () => {
        expect(
            stripStalkerPortalMarkup(
                'Your STB is damaged.<br/> Call the provider.'
            )
        ).toBe('Your STB is damaged. Call the provider.');
    });

    it('collapses whitespace and trims', () => {
        expect(stripStalkerPortalMarkup('  a \n b  ')).toBe('a b');
    });
});

describe('combineStalkerPortalMessages', () => {
    it('joins msg and block_msg', () => {
        expect(
            combineStalkerPortalMessages('device conflict', 'STB damaged')
        ).toBe('device conflict — STB damaged');
    });

    it('drops empty and duplicated parts', () => {
        expect(combineStalkerPortalMessages('', undefined)).toBeUndefined();
        expect(combineStalkerPortalMessages('same', 'same')).toBe('same');
    });
});

describe('isStalkerDeviceConflictMessage', () => {
    it.each([
        // What the stock middleware and the mock server actually send.
        'device conflict - device_id mismatch',
        'device conflict - MAC address mismatch',
        'Device Conflict',
        'device_id mismatch',
        'device id does not match the registered one',
    ])('recognizes %p', (message) => {
        expect(isStalkerDeviceConflictMessage(message)).toBe(true);
    });

    it.each([
        // Other status-1 refusals that must keep the generic `blocked`
        // headline — offering "restore your first device ID" for any of
        // these would send the user down a dead end.
        'Account disabled',
        'Your subscription has expired',
        'Device limit reached',
        'No device selected',
        'Your STB is damaged. Call the provider.',
    ])('does not claim %p is a device conflict', (message) => {
        expect(isStalkerDeviceConflictMessage(message)).toBe(false);
    });

    it('is false without portal text', () => {
        expect(isStalkerDeviceConflictMessage(undefined)).toBe(false);
        expect(isStalkerDeviceConflictMessage('')).toBe(false);
    });

    it('does not bridge sentence boundaries', () => {
        // "device_id" in one sentence and "mismatch" in the next are two
        // unrelated statements.
        expect(
            isStalkerDeviceConflictMessage(
                'Your device_id is recorded. A password mismatch was logged.'
            )
        ).toBe(false);
    });
});

describe('asStalkerPortalError', () => {
    it('recognizes real instances', () => {
        const error = new StalkerPortalError('blocked', 'text');
        expect(asStalkerPortalError(error)).toBe(error);
    });

    it('recognizes a structurally equivalent object across chunk boundaries', () => {
        const shaped = {
            name: 'StalkerPortalError',
            kind: 'login-required',
            message: 'refused',
        };
        expect(asStalkerPortalError(shaped)?.kind).toBe('login-required');
    });

    it('rejects ordinary errors and non-errors', () => {
        expect(asStalkerPortalError(new Error('nope'))).toBeNull();
        expect(asStalkerPortalError('Access denied.')).toBeNull();
        expect(asStalkerPortalError(null)).toBeNull();
    });
});
