import {
    asStalkerPortalError,
    combineStalkerPortalMessages,
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
