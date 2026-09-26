import { buildM3uSeriesCatalog } from './m3u-series-aggregate.util';

const row = (name: string, group = 'Shows', logo?: string) => ({
    url: `http://h.example/series/u/p/${encodeURIComponent(name)}.mp4`,
    name,
    group: { title: group },
    tvg: { logo },
});

const build = (names: string[], playlistId = 'pl-1') =>
    buildM3uSeriesCatalog(
        names.map((name) => row(name)),
        playlistId
    );

describe('buildM3uSeriesCatalog', () => {
    it('collapses episodes of one show into a single series', () => {
        const series = build([
            'BLACK MIRROR S1 E1',
            'BLACK MIRROR S1 E2',
            'BLACK MIRROR S2 E1',
        ]);

        expect(series).toHaveLength(1);
        expect(series[0].title).toBe('BLACK MIRROR');
        expect(series[0].episodeCount).toBe(3);
        expect([...series[0].seasons.keys()]).toEqual([1, 2]);
        expect(series[0].seasons.get(1)).toHaveLength(2);
    });

    it('sorts seasons and episodes numerically, not by arrival', () => {
        const series = build([
            'SHOW S2 E10',
            'SHOW S1 E2',
            'SHOW S2 E2',
            'SHOW S1 E1',
        ]);

        expect([...series[0].seasons.keys()]).toEqual([1, 2]);
        expect(series[0].seasons.get(2)?.map((e) => e.episodeNumber)).toEqual([
            2, 10,
        ]);
    });

    it('keeps two dubs of one show apart', () => {
        // Merging them would interleave Turkish and German audio inside one
        // season, leaving S1E1 ambiguous and the up-next order arbitrary.
        const series = build([
            'TR:MODERN FAMILY S1 E1',
            'DE:MODERN FAMILY S1 E1',
        ]);

        expect(series).toHaveLength(2);
        expect(series.map((s) => s.languageTag).sort()).toEqual(['DE', 'TR']);
        expect(series.every((s) => s.title === 'MODERN FAMILY')).toBe(true);
    });

    it('merges a yeared title with an unyeared one under the same tag', () => {
        const series = build(['TR:BET 2025 S1 E1', 'TR:BET S1 E2']);

        expect(series).toHaveLength(1);
        expect(series[0].episodeCount).toBe(2);
        expect(series[0].yearHint).toBe(2025);
    });

    it('keeps remakes that share a title apart', () => {
        // Two stated years is the evidence that these are different shows.
        // Merged, one remake's watch progress and TMDB match would attach
        // to the other.
        const series = build([
            'SHOW 2020 S1 E1',
            'SHOW 2020 S1 E2',
            'SHOW 2021 S1 E1',
        ]);

        expect(series).toHaveLength(2);
        expect(series.map((s) => s.yearHint).sort()).toEqual([2020, 2021]);
        expect(series.find((s) => s.yearHint === 2020)?.episodeCount).toBe(2);
        expect(series.find((s) => s.yearHint === 2021)?.episodeCount).toBe(1);
    });

    it('gives remakes distinct episode ids', () => {
        // The ids follow the split key, or the two shows would share watch
        // history for the same season and episode number.
        const series = build(['SHOW 2020 S1 E1', 'SHOW 2021 S1 E1']);
        const ids = series.map((s) => s.seasons.get(1)?.[0].id);

        expect(new Set(ids).size).toBe(2);
    });

    it.each([
        ['after', ['SHOW 2017 S1 E1', 'SHOW 2024 S1 E1']],
        ['before', ['SHOW 2024 S1 E1', 'SHOW 2017 S1 E1']],
    ])(
        'keeps the original ids when a remake arrives (listed %s it)',
        (_order, names) => {
            // Watch progress is stored under these ids. A refresh that adds
            // a remake must not re-mint the show the viewer was watching.
            const [before] = build(['SHOW 2017 S1 E1']);
            const after = build(names);
            const original = after.find((s) => s.yearHint === 2017);
            const remake = after.find((s) => s.yearHint === 2024);

            expect(original?.id).toBe(before.id);
            expect(original?.seasons.get(1)?.[0].id).toBe(
                before.seasons.get(1)?.[0].id
            );
            expect(remake?.seasons.get(1)?.[0].id).not.toBe(
                before.seasons.get(1)?.[0].id
            );
        }
    );

    it('keeps episode ids distinct when unyeared rows sit beside two remakes', () => {
        // The unyeared rows keep a key of their own, so handing the
        // year-free key to the original cannot collide with them.
        const series = build([
            'SHOW 2017 S1 E1',
            'SHOW 2024 S1 E1',
            'SHOW S1 E1',
        ]);
        const ids = series.map((s) => s.seasons.get(1)?.[0].id);

        expect(series).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);
        expect(new Set(series.map((s) => s.id)).size).toBe(3);
    });

    it('does not split when only one year is stated', () => {
        // This is what keeps a yeared title merging with its unyeared
        // siblings, which real providers write constantly.
        const series = build(['TR:BET 2025 S1 E1', 'TR:BET S1 E2']);

        expect(series).toHaveLength(1);
        expect(series[0].episodeCount).toBe(2);
    });

    it('spans groups rather than fragmenting by them', () => {
        // A show's episodes legitimately sit in more than one provider
        // group; keying on the group would split it into two series.
        const series = buildM3uSeriesCatalog(
            [
                row('SHOW S1 E1', 'MULTI SERIES'),
                row('SHOW S1 E2', 'Pazartesi Dizileri'),
                row('SHOW S1 E3', 'Pazartesi Dizileri'),
            ],
            'pl-1'
        );

        expect(series).toHaveLength(1);
        expect(series[0].groups).toEqual([
            'MULTI SERIES',
            'Pazartesi Dizileri',
        ]);
        expect(series[0].primaryGroup).toBe('Pazartesi Dizileri');
    });

    it('keeps group membership when a yeared title merges with a bare one', () => {
        // The bare and yeared spellings of one show are merged into a
        // single series, so the merge has to carry BOTH parts' groups.
        // Keeping only the first part's tally files the show under
        // whichever spelling happened to be read first, which is not
        // necessarily where most of its episodes live.
        const series = buildM3uSeriesCatalog(
            [
                row('SHOW 2024 S1 E1', 'Yeni Diziler'),
                row('SHOW S1 E2', 'Pazartesi Dizileri'),
                row('SHOW S1 E3', 'Pazartesi Dizileri'),
            ],
            'pl-1'
        );

        expect(series).toHaveLength(1);
        expect(series[0].groups).toEqual([
            'Yeni Diziler',
            'Pazartesi Dizileri',
        ]);
        expect(series[0].primaryGroup).toBe('Pazartesi Dizileri');
    });

    it('parks a duplicate season/episode as an alternative', () => {
        // Same episode at another quality. It must not become a second
        // episode, and it must not vanish.
        const series = buildM3uSeriesCatalog(
            [row('SHOW S1 E1', 'HD'), row('SHOW S1 E1 FHD', 'FHD')],
            'pl-1'
        );

        expect(series[0].episodeCount).toBe(1);
        expect(series[0].seasons.get(1)?.[0].alternatives).toHaveLength(1);
    });

    it('defaults a seasonless daily serial to season one', () => {
        const series = build(['DELIKANLI 5.BÖLÜM', 'DELIKANLI 6.BÖLÜM']);

        expect(series).toHaveLength(1);
        expect([...series[0].seasons.keys()]).toEqual([1]);
        expect(series[0].seasons.get(1)?.map((e) => e.episodeNumber)).toEqual([
            5, 6,
        ]);
    });

    it('gives every episode a stable, distinct id', () => {
        const first = build(['SHOW S1 E1', 'SHOW S1 E2', 'SHOW S2 E1']);
        const again = build(['SHOW S2 E1', 'SHOW S1 E2', 'SHOW S1 E1']);

        const ids = (catalog: ReturnType<typeof build>) =>
            [...catalog[0].seasons.values()]
                .flat()
                .map(
                    (episode) =>
                        `${episode.seasonNumber}x${episode.episodeNumber}=${episode.id}`
                )
                .sort();

        expect(ids(first)).toEqual(ids(again));
        expect(new Set(ids(first)).size).toBe(3);
    });

    it('keys series per playlist', () => {
        const a = build(['SHOW S1 E1'], 'pl-1');
        const b = build(['SHOW S1 E1'], 'pl-2');

        expect(a[0].key).not.toBe(b[0].key);
        expect(a[0].id).not.toBe(b[0].id);
    });

    it('takes the first artwork any episode carries', () => {
        const series = buildM3uSeriesCatalog(
            [
                row('SHOW S1 E1', 'Shows'),
                row('SHOW S1 E2', 'Shows', 'http://logo/show.png'),
            ],
            'pl-1'
        );

        expect(series[0].posterUrl).toBe('http://logo/show.png');
    });

    it('skips a row that is nothing but a marker', () => {
        // There is no series name in "S01E01" to file it under, and taking
        // the marker as a title would mint one phantom series per episode.
        const series = buildM3uSeriesCatalog(
            [row('S01E01'), row('SHOW S1 E1')],
            'pl-1'
        );

        expect(series).toHaveLength(1);
        expect(series[0].title).toBe('SHOW');
    });

    it('keeps a row whose name carries no marker at all', () => {
        // Classified as an episode by its /series/ path but named in a way
        // the parser does not recognise. Dropping it would make provider
        // content vanish from the catalog with no trace.
        const series = buildM3uSeriesCatalog(
            [row('Some Documentary Feature')],
            'pl-1'
        );

        expect(series).toHaveLength(1);
        expect(series[0].title).toBe('Some Documentary Feature');
        expect(series[0].episodeCount).toBe(1);
    });

    it('carries the episode title the provider wrote', () => {
        // The parser separates it from the series name; dropping it here
        // would leave every episode grid cell repeating the show's name.
        const series = build(['SHOW S1 E1 - Good News', 'SHOW S1 E2']);

        expect(series[0].seasons.get(1)?.map((e) => e.title)).toEqual([
            'Good News',
            null,
        ]);
    });

    it('handles an absent list', () => {
        expect(buildM3uSeriesCatalog(null, 'pl-1')).toEqual([]);
        expect(buildM3uSeriesCatalog([], 'pl-1')).toEqual([]);
    });
});
