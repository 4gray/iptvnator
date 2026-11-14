import {
    type ScopedHeaderOverride,
    selectScopedOverrides,
    toComparableUrl,
} from './request-header-override-matching';

function scoped(
    scopeUrl: string,
    sequence: number,
    userAgent: string
): ScopedHeaderOverride {
    return {
        scopeOrigins: new Set([new URL(scopeUrl).origin]),
        scopeUrl: toComparableUrl(scopeUrl),
        sequence,
        userAgent,
    };
}

const agents = (overrides: ScopedHeaderOverride[]): (string | undefined)[] =>
    overrides.map((override) => override.userAgent);

describe('selectScopedOverrides', () => {
    it('returns nothing when no override covers the request origin', () => {
        expect(
            selectScopedOverrides('https://other.example/x', [
                scoped('https://a.example/one.ts', 1, 'A'),
            ])
        ).toEqual([]);
    });

    it('returns the single matching override untouched', () => {
        const only = scoped('https://a.example/one.ts', 1, 'A');
        expect(
            selectScopedOverrides('https://a.example/segment.ts', [
                only,
                scoped('https://b.example/two.ts', 2, 'B'),
            ])
        ).toEqual([only]);
    });

    it('picks the most recently configured override on a shared origin', () => {
        expect(
            agents(
                selectScopedOverrides('https://a.example/segment.ts', [
                    scoped('https://a.example/two.ts', 5, 'later'),
                    scoped('https://a.example/one.ts', 2, 'earlier'),
                ])
            )
        ).toEqual(['later']);
    });

    it("picks the exact stream URL's owner over a newer one", () => {
        expect(
            agents(
                selectScopedOverrides('https://a.example/one.ts', [
                    scoped('https://a.example/one.ts', 1, 'exact'),
                    scoped('https://a.example/two.ts', 9, 'newer'),
                ])
            )
        ).toEqual(['exact']);
    });

    it('never merges headers of two owners', () => {
        const withCredentials: ScopedHeaderOverride = {
            ...scoped('https://a.example/one.ts', 1, 'A'),
            authorization: 'Bearer synthetic-a',
            referer: 'https://a.example/',
        };
        const selected = selectScopedOverrides('https://a.example/two.ts', [
            withCredentials,
            scoped('https://a.example/two.ts', 2, 'B'),
        ]);

        expect(selected).toHaveLength(1);
        expect(selected[0].userAgent).toBe('B');
        expect(selected[0].authorization).toBeUndefined();
        expect(selected[0].referer).toBeUndefined();
    });
});

describe('header-free owners', () => {
    it('claim only their exact stream URL and apply nothing', () => {
        const headerFree: ScopedHeaderOverride = {
            ...scoped('https://a.example/two.ts', 9, ''),
            userAgent: undefined,
            headerFree: true,
        };
        const owner = scoped('https://a.example/one.ts', 1, 'A');

        expect(
            selectScopedOverrides('https://a.example/two.ts', [
                owner,
                headerFree,
            ])
        ).toEqual([]);
        expect(
            agents(
                selectScopedOverrides('https://a.example/seg.ts', [
                    owner,
                    headerFree,
                ])
            )
        ).toEqual(['A']);
    });
});

describe('a restored player and a released tile on one URL', () => {
    it("keeps the player's headers over the tile's header-free claim", () => {
        const player = scoped('https://a.example/one.ts', 4, 'Player');
        const releasedTile: ScopedHeaderOverride = {
            ...scoped('https://a.example/one.ts', 9, ''),
            userAgent: undefined,
            headerFree: true,
        };

        expect(
            agents(
                selectScopedOverrides('https://a.example/one.ts', [
                    player,
                    releasedTile,
                ])
            )
        ).toEqual(['Player']);
    });
});

describe('toComparableUrl', () => {
    it('normalizes the way request URLs are reported', () => {
        expect(toComparableUrl(' HTTPS://A.Example:443/live/one.ts ')).toBe(
            'https://a.example/live/one.ts'
        );
    });

    it.each([undefined, null, 42, '', 'not a url'])(
        'maps %p to a value no request can equal',
        (value) => {
            expect(toComparableUrl(value)).toBe('');
        }
    );
});
