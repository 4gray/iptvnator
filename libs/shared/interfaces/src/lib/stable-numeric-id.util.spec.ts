import { createM3uIdHasher, hashM3uId } from './stable-numeric-id.util';

describe('hashM3uId', () => {
    it('is deterministic', () => {
        expect(hashM3uId('SHOW\u00001x1')).toBe(hashM3uId('SHOW\u00001x1'));
    });

    it('separates keys that differ only in the episode', () => {
        expect(hashM3uId('SHOW\u00001x1')).not.toBe(hashM3uId('SHOW\u00001x2'));
    });

    it('separates keys that differ only in the season', () => {
        expect(hashM3uId('SHOW\u00001x1')).not.toBe(hashM3uId('SHOW\u00002x1'));
    });

    it('stays a safe positive integer', () => {
        for (const value of ['', 'a', 'SHOW\u00001x1', '\u0000'.repeat(50)]) {
            const id = hashM3uId(value);
            expect(Number.isSafeInteger(id)).toBe(true);
            expect(id).toBeGreaterThan(0);
            expect(id).toBeLessThan(2 ** 48);
        }
    });

    it('collides rarely enough to key watch history', () => {
        // A collision makes two episodes share one playback-position row,
        // so the viewer sees the wrong episode marked watched. This is the
        // measurement that justifies 48 bits over the 31-bit hash used
        // elsewhere, which would collide roughly once per 250 catalogs of
        // this size.
        const ids = new Set<number>();
        for (let series = 0; series < 2000; series += 1) {
            for (let episode = 0; episode < 21; episode += 1) {
                ids.add(hashM3uId(`series-${series}\u00001x${episode}`));
            }
        }

        expect(ids.size).toBe(2000 * 21);
    });
});

describe('createM3uIdHasher', () => {
    it('mints exactly the id of the whole key', () => {
        // These ids key persisted watch progress: continuing the hash from a
        // prefix is an optimisation and must not change a single one.
        const mint = createM3uIdHasher('pl-1\u0000tr\u0000şöhret\u0000');

        for (const suffix of ['1x1', '12x340', 'row\u0000file-7.mp4', '']) {
            expect(mint(suffix)).toBe(
                hashM3uId(`pl-1\u0000tr\u0000şöhret\u0000${suffix}`)
            );
        }
    });

    it('keeps no state between ids', () => {
        const mint = createM3uIdHasher('SHOW\u0000');

        expect(mint('1x2')).toBe(mint('1x2'));
        expect(mint('1x1')).not.toBe(mint('1x2'));
    });
});
