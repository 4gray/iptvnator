import type { TmdbTvDetails } from './tmdb.types';

it('keeps cache trimming on the core entry without loading credit presentation helpers', async () => {
    const loadCredits = jest.fn();
    try {
        await jest.isolateModulesAsync(async () => {
            jest.doMock('./tmdb-credits', () => {
                loadCredits();
                return jest.requireActual('./tmdb-credits');
            });
            const { trimDetailsForCache } = await import('../index');
            const leadRole = { character: 'Guide', episode_count: 8 };
            const details: TmdbTvDetails = {
                id: 101,
                name: 'Example Series',
                aggregate_credits: {
                    cast: [
                        {
                            id: 1,
                            name: 'Example Performer',
                            roles: [
                                { character: 'Visitor', episode_count: 1 },
                                leadRole,
                            ],
                        },
                    ],
                },
            };

            const trimmed = trimDetailsForCache(details) as TmdbTvDetails;

            expect(trimmed.aggregate_credits?.cast?.[0].roles).toEqual([
                leadRole,
            ]);
            expect(details.aggregate_credits?.cast?.[0].roles).toHaveLength(2);
            expect(loadCredits).not.toHaveBeenCalled();
        });
    } finally {
        jest.dontMock('./tmdb-credits');
    }
});
