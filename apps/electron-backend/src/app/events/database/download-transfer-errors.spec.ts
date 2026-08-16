import { classifyRangeNotSatisfiable } from './download-transfer-errors';

describe('classifyRangeNotSatisfiable', () => {
    const base = { resumeOffset: 37_856, retainedOffset: 300_000 };

    it.each([
        {
            expected: 'retain',
            input: {
                ...base,
                confirmedTotal: null,
                identityProven: false,
            },
            label: 'a rewound 416 without a stated length proves nothing',
        },
        {
            expected: 'restart',
            input: {
                ...base,
                confirmedTotal: 37_856,
                identityProven: false,
            },
            label: 'a rewound range beginning at the new EOF proves shrinkage',
        },
        {
            expected: 'restart',
            input: { ...base, confirmedTotal: 30, identityProven: false },
            label: 'a stated total below the rewound offset proves shrinkage',
        },
        {
            expected: 'retain',
            input: {
                ...base,
                confirmedTotal: 300_000,
                identityProven: false,
            },
            label: 'a bare length match on a rewound request is contradictory',
        },
        {
            expected: 'complete',
            input: {
                confirmedTotal: 300_000,
                identityProven: true,
                resumeOffset: 300_000,
                retainedOffset: 300_000,
            },
            label: 'an identity-proven exact-EOF length match completes',
        },
        {
            expected: 'retain',
            input: {
                confirmedTotal: null,
                identityProven: true,
                resumeOffset: 300_000,
                retainedOffset: 300_000,
            },
            label: 'a length-less exact-EOF 416 is inconclusive',
        },
        {
            expected: 'restart',
            input: {
                confirmedTotal: 200_000,
                identityProven: true,
                resumeOffset: 300_000,
                retainedOffset: 300_000,
            },
            label: 'an exact-EOF 416 stating a smaller entity proves shrinkage',
        },
    ])('$label -> $expected', ({ expected, input }) => {
        expect(classifyRangeNotSatisfiable(input)).toBe(expected);
    });
});
