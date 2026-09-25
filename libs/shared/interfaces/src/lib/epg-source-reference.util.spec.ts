import {
    classifyEpgSourceReference,
    isLocalEpgSourceReference,
    isRemoteEpgSourceUrl,
    validateEpgSourceReferenceControl,
} from './epg-source-reference.util';

describe('classifyEpgSourceReference', () => {
    it.each([
        'http://epg.example.org/guide.xml',
        'https://epg.example.org/guide.xml.gz?token=abc',
        '  HTTPS://epg.example.org/guide.xml  ',
    ])('treats %s as remote', (value) => {
        expect(classifyEpgSourceReference(value)).toBe('remote');
        expect(isRemoteEpgSourceUrl(value)).toBe(true);
        expect(isLocalEpgSourceReference(value)).toBe(false);
    });

    it.each([
        'file:///home/user/epg/guide.xml.gz',
        'file:///C:/epg/guide.xml',
        '/home/user/epg/guide.xml',
        '/Users/me/Downloads/guide.xml.gz',
        'C:\\epg\\guide.xml.gz',
        'd:/epg/guide.xml',
        '\\\\nas\\share\\epg\\guide.xml.gz',
    ])('treats %s as a local file', (value) => {
        expect(classifyEpgSourceReference(value)).toBe('local');
        expect(isLocalEpgSourceReference(value)).toBe(true);
        expect(isRemoteEpgSourceUrl(value)).toBe(false);
    });

    it.each([
        'guide.xml',
        './guide.xml',
        '~/epg/guide.xml',
        'ftp://epg.example.org/guide.xml',
        'file://',
        'epg.example.org/guide.xml',
        'C:',
        '',
        '   ',
    ])('rejects %j', (value) => {
        expect(classifyEpgSourceReference(value)).toBeNull();
    });

    it('rejects null and undefined', () => {
        expect(classifyEpgSourceReference(null)).toBeNull();
        expect(classifyEpgSourceReference(undefined)).toBeNull();
    });
});

describe('validateEpgSourceReferenceControl', () => {
    it('accepts an empty control like Validators.pattern does', () => {
        expect(validateEpgSourceReferenceControl({ value: '' })).toBeNull();
        expect(validateEpgSourceReferenceControl({ value: null })).toBeNull();
    });

    it('accepts remote links and local files', () => {
        expect(
            validateEpgSourceReferenceControl({
                value: 'https://epg.example.org/guide.xml',
            })
        ).toBeNull();
        expect(
            validateEpgSourceReferenceControl({ value: '/tmp/guide.xml.gz' })
        ).toBeNull();
    });

    it('flags relative paths and unsupported schemes', () => {
        expect(
            validateEpgSourceReferenceControl({ value: 'guide.xml' })
        ).toEqual({ epgSourceReference: true });
        expect(
            validateEpgSourceReferenceControl({
                value: 'ftp://epg.example.org/guide.xml',
            })
        ).toEqual({ epgSourceReference: true });
    });
});
