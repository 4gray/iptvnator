import { hashM3uId } from './stable-numeric-id.util';

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
