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

    it('orders same-origin overrides by configure sequence', () => {
        expect(
            agents(
                selectScopedOverrides('https://a.example/segment.ts', [
                    scoped('https://a.example/two.ts', 5, 'later'),
                    scoped('https://a.example/one.ts', 2, 'earlier'),
                ])
            )
        ).toEqual(['earlier', 'later']);
    });

    it('puts the exact stream URL last even when it was configured first', () => {
        expect(
            agents(
                selectScopedOverrides('https://a.example/one.ts', [
                    scoped('https://a.example/one.ts', 1, 'exact'),
                    scoped('https://a.example/two.ts', 9, 'newer'),
                ])
            )
        ).toEqual(['newer', 'exact']);
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
