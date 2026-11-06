import { pickAggregateRole } from './tmdb-aggregate-role';

describe('pickAggregateRole', () => {
    it.each([
        {},
        { roles: [] },
        { roles: [{ episode_count: 20 }] },
        { roles: [{ character: '', episode_count: 20 }] },
        { roles: [{ character: '   ', episode_count: 20 }] },
    ])('returns no role when none is named: %j', (member) => {
        expect(pickAggregateRole(member)).toBeUndefined();
    });

    it('ignores unnamed appearances and selects the longest role without mutating the payload', () => {
        const roles = [
            { character: 'Visitor', episode_count: 1 },
            { character: 'Guide', episode_count: 8 },
            { character: '   ', episode_count: 20 },
            { episode_count: 30 },
            { character: 'Companion', episode_count: 3 },
        ];
        const original = structuredClone(roles);

        expect(pickAggregateRole({ roles })).toBe(roles[1]);
        expect(roles).toEqual(original);
    });

    it.each([
        { counts: [undefined, undefined], expected: 0 },
        { counts: [undefined, 3], expected: 1 },
        { counts: [3, undefined], expected: 0 },
        { counts: [3, 3], expected: 0 },
    ])(
        'treats absent counts as zero and keeps the first role on ties: %j',
        ({ counts, expected }) => {
            const roles = counts.map((episode_count, index) => ({
                character: `Example Role ${index}`,
                episode_count,
            }));

            expect(pickAggregateRole({ roles })).toBe(roles[expected]);
        }
    );
});
