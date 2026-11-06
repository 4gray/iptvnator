import {
    hasPartialImportScope,
    normalizeImportScope,
    shouldImportLive,
    shouldImportVod,
} from './playlist-import-scope.util';

describe('playlist import scope', () => {
    it('imports everything when the scope is absent (legacy sources)', () => {
        expect(shouldImportLive(undefined)).toBe(true);
        expect(shouldImportVod(undefined)).toBe(true);
        expect(shouldImportLive({})).toBe(true);
        expect(shouldImportVod({})).toBe(true);
        expect(hasPartialImportScope(undefined)).toBe(false);
    });

    it('honors explicit opt-outs per section', () => {
        expect(shouldImportLive({ importLive: false })).toBe(false);
        expect(shouldImportVod({ importVod: false })).toBe(false);
        expect(hasPartialImportScope({ importVod: false })).toBe(true);
        expect(
            hasPartialImportScope({ importLive: true, importVod: true })
        ).toBe(false);
    });

    it('repairs a scope that disables everything back to a full import', () => {
        expect(
            normalizeImportScope({ importLive: false, importVod: false })
        ).toEqual({ importLive: true, importVod: true });
        expect(normalizeImportScope({ importVod: false })).toEqual({
            importLive: true,
            importVod: false,
        });
    });
});
