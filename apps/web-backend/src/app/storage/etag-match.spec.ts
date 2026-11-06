import { matchesEtag } from './etag-match';

describe('matchesEtag', () => {
    const etag = '"boot.0.1"';

    it('matches the same strong or weakened tag', () => {
        expect(matchesEtag(etag, etag)).toBe(true);
        expect(matchesEtag(`W/${etag}`, etag)).toBe(true);
    });

    it('matches one of several listed tags and the wildcard', () => {
        expect(matchesEtag(`"other", W/${etag}`, etag)).toBe(true);
        expect(matchesEtag('*', etag)).toBe(true);
    });

    it('does not match a missing or different tag', () => {
        expect(matchesEtag(undefined, etag)).toBe(false);
        expect(matchesEtag('"boot.0.2"', etag)).toBe(false);
    });
});
