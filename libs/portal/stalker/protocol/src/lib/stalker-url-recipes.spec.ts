import {
    StalkerProtocolInputError,
    deduplicateAndLimitStalkerEndpointCandidates,
    deriveStalkerEndpointCandidates,
    normalizeStalkerSourceUrl,
} from './stalker-url-recipes';

describe('Stalker endpoint URL recipes', () => {
    it.each([
        [
            'https://portal.test/custom/portal.php',
            ['https://portal.test/custom/portal.php'],
        ],
        [
            'https://portal.test/custom/server/load.php',
            ['https://portal.test/custom/server/load.php'],
        ],
    ])('keeps a direct API endpoint first', (sourceUrl, expected) => {
        expect(deriveStalkerEndpointCandidates(sourceUrl)).toEqual(expected);
    });

    it('derives root and conventional stalker_portal candidates', () => {
        expect(deriveStalkerEndpointCandidates('https://portal.test/')).toEqual([
            'https://portal.test/server/load.php',
            'https://portal.test/portal.php',
            'https://portal.test/stalker_portal/server/load.php',
            'https://portal.test/stalker_portal/portal.php',
        ]);
    });

    it.each([
        ['https://portal.test/c', 'https://portal.test'],
        ['https://portal.test/c/', 'https://portal.test'],
        ['https://portal.test/c/index.html', 'https://portal.test'],
        ['https://portal.test/prefix/c/', 'https://portal.test/prefix'],
    ])('derives /c/ candidates from its parent', (sourceUrl, parent) => {
        expect(deriveStalkerEndpointCandidates(sourceUrl)).toEqual([
            `${parent}/server/load.php`,
            `${parent}/portal.php`,
        ]);
    });

    it.each([
        ['https://portal.test/custom', 'https://portal.test/custom'],
        ['https://portal.test/custom/', 'https://portal.test/custom'],
        ['https://portal.test/custom/index.html', 'https://portal.test/custom'],
    ])('derives same-directory candidates', (sourceUrl, directory) => {
        expect(deriveStalkerEndpointCandidates(sourceUrl)).toEqual([
            `${directory}/server/load.php`,
            `${directory}/portal.php`,
        ]);
    });

    it('deduplicates in order and enforces the six-candidate cap', () => {
        expect(
            deduplicateAndLimitStalkerEndpointCandidates([
                'https://portal.test/1',
                'https://portal.test/2',
                'https://portal.test/1',
                'https://portal.test/3',
                'https://portal.test/4',
                'https://portal.test/5',
                'https://portal.test/6',
                'https://portal.test/7',
            ])
        ).toEqual([
            'https://portal.test/1',
            'https://portal.test/2',
            'https://portal.test/3',
            'https://portal.test/4',
            'https://portal.test/5',
            'https://portal.test/6',
        ]);
    });

    it('strips fragments while preserving a non-sensitive landing query', () => {
        expect(
            normalizeStalkerSourceUrl(
                'https://portal.test/c/?theme=dark#credentials'
            )
        ).toBe('https://portal.test/c/?theme=dark');
        expect(
            deriveStalkerEndpointCandidates(
                'https://portal.test/c/?theme=dark#credentials'
            )
        ).toEqual([
            'https://portal.test/server/load.php',
            'https://portal.test/portal.php',
        ]);
    });

    it.each([
        'https://user:password@portal.test/c/',
        'https://portal.test/c/?username=account',
        'https://portal.test/c/?PASSWORD=secret',
        'https://portal.test/c/?token=secret',
        'https://portal.test/c/?mac=00%3A1A%3A79%3A00%3A00%3A01',
        'ftp://portal.test/c/',
    ])('rejects credential-bearing or unsupported URLs', (sourceUrl) => {
        expect(() => normalizeStalkerSourceUrl(sourceUrl)).toThrow(
            new StalkerProtocolInputError('invalid-url')
        );
    });
});
