import {
    isTmdbTransferCapability,
    isTmdbTransferKey,
} from './source-sync.interface';

describe('TMDB transfer inputs', () => {
    it('accepts a complete URL-safe transfer token', () => {
        expect(isTmdbTransferCapability('x'.repeat(30) + '_-')).toBe(true);
        expect(isTmdbTransferCapability('x'.repeat(31))).toBe(false);
        expect(isTmdbTransferCapability('x'.repeat(31) + '/')).toBe(false);
        expect(isTmdbTransferCapability(null)).toBe(false);
    });

    it('accepts personal API keys and bounds untrusted payloads', () => {
        expect(isTmdbTransferKey('0'.repeat(32))).toBe(true);
        expect(isTmdbTransferKey('synthetic.header.signature')).toBe(true);
        expect(isTmdbTransferKey('x'.repeat(2048))).toBe(true);
        for (const value of ['', 'x'.repeat(2049), 'key\n', 'key value', 32])
            expect(isTmdbTransferKey(value)).toBe(false);
    });
});
