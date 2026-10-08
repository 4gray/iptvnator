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

    it('keeps a row that is nothing but a marker', () => {
        // There is no series name in "S01E01", but the row plays and is no
        // longer in the channel list: skipped, it would be nowhere. It is
        // filed alone, under the only name it has.
        const series = buildM3uSeriesCatalog(
            [row('S01E01'), row('SHOW S1 E1')],
            'pl-1'
        );

        expect(series.map((entry) => entry.title).sort()).toEqual([
            'S01E01',
            'SHOW',
        ]);
    });

    it('keeps a row with no usable name under its file name', () => {
        const blank = {
            ...row(''),
            url: 'http://h.example/series/u/p/Clip-9.mp4',
        };
        const dashes = {
            ...row('---'),
            url: 'http://h.example/series/u/p/other.mp4',
        };
        const series = buildM3uSeriesCatalog([blank, dashes], 'pl-1');

        expect(series.map((entry) => entry.title).sort()).toEqual([
            '---',
            'clip-9.mp4',
        ]);
        expect(series.every((entry) => entry.episodeCount === 1)).toBe(true);
    });

    it('keeps a row whose marker the parser reads no episode from', () => {
        // "Season 1" is a marker, but there is no episode number in it. The
        // row is already out of the channel list, so skipping it here would
        // leave a playable entry nowhere.
        const series = buildM3uSeriesCatalog(
            [row('Dark Season 1'), row('Dark - Staffel 2')],
            'pl-1'
        );

        expect(series.map((entry) => entry.title).sort()).toEqual([
            'Dark - Staffel 2',
            'Dark Season 1',
        ]);
    });

    it('does not put such a row on top of an episode of the real series', () => {
        // Normalized, "Dark Season 1" keys as "dark" and would take S1E1.
        const series = buildM3uSeriesCatalog(
            [row('Dark S01E01'), row('Dark Season 1')],
            'pl-1'
        );

        expect(
            Object.fromEntries(
                series.map((entry) => [entry.title, entry.episodeCount])
            )
        ).toEqual({ Dark: 1, 'Dark Season 1': 1 });
        expect(
            series.find((entry) => entry.title === 'Dark')?.seasons.get(1)?.[0]
                .channel.name
        ).toBe('Dark S01E01');
    });

    it('keeps every row of a show whose rows carry no numbers', () => {
        // Same name, different files: without numbers they all resolved to
        // S1E1, and all but the first were parked where nothing plays them.
        const rows = [1, 2, 3].map((n) => ({
            ...row('Planet Earth'),
            url: `http://h.example/series/u/p/earth-${n}.mp4`,
        }));
        const series = buildM3uSeriesCatalog(
            [...rows, { ...rows[0] }, row('Planet Earth S01E01')],
            'pl-1'
        );

        expect(series).toHaveLength(1);
        const episodes = series[0].seasons.get(1) ?? [];
        // The numbered row keeps the coordinate it states; the repeated URL
        // is one row, not two.
        expect(
            episodes.map((episode) => [
                episode.episodeNumber,
                episode.channel.url,
            ])
        ).toEqual([
            [1, row('Planet Earth S01E01').url],
            [2, rows[0].url],
            [3, rows[1].url],
            [4, rows[2].url],
        ]);
        expect(new Set(episodes.map((episode) => episode.id)).size).toBe(4);
    });

    it('keeps the id of an unnumbered row when the rows move or the tokens rotate', () => {
        // The slot such a row is listed at is not its identity: a watched
        // mark keyed on it would jump to another episode on the next refresh.
        const earth = (file: string, token = 'u/p') => ({
            ...row('Planet Earth'),
            url: `http://h.example/series/${token}/${file}.mp4?t=${token}`,
        });
        const idsByFile = (rows: ReturnType<typeof earth>[]) =>
            Object.fromEntries(
                (
                    buildM3uSeriesCatalog(rows, 'pl-1')[0].seasons.get(1) ?? []
                ).map((episode) => [
                    new URL(episode.channel.url).pathname
                        .split('/')
                        .pop()
                        ?.split('.')[0],
                    episode.id,
                ])
            );

        const before = idsByFile([earth('a'), earth('b'), earth('c')]);
        const after = idsByFile([
            earth('c', 'x/y'),
            row('Planet Earth S01E01') as ReturnType<typeof earth>,
            earth('a', 'x/y'),
            earth('b', 'x/y'),
        ]);

        expect(after).toEqual(expect.objectContaining(before));
        expect(new Set(Object.values(before)).size).toBe(3);
    });

    it('keeps unnumbered rows apart when year variants of a title merge', () => {
        // "Show" and "Show 2025" are one series, and each variant lists its
        // first unnumbered row at slot 1. Merging by slot hid one of them.
        const file = (name: string, n: number) => ({
            ...row(name),
            url: `http://h.example/series/u/p/file-${n}.mp4`,
        });
        const series = buildM3uSeriesCatalog(
            [file('Show', 1), file('Show 2025', 2), file('Show 2025', 3)],
            'pl-1'
        );

        expect(series).toHaveLength(1);
        const episodes = series[0].seasons.get(1) ?? [];
        expect(episodes.map((episode) => episode.channel.url).sort()).toEqual([
            file('Show', 1).url,
            file('Show 2025', 2).url,
            file('Show 2025', 3).url,
        ]);
        expect(new Set(episodes.map((episode) => episode.id)).size).toBe(3);
        expect(episodes.map((episode) => episode.episodeNumber)).toEqual([
            1, 2, 3,
        ]);
    });

    it('does not swap the ids of unnumbered rows that share a file name', () => {
        // Two `index.m3u8` under different directories: nothing but the
        // whole URL tells them apart, and an occurrence counter would hand
        // each the other's watch history when the provider reorders them.
        const stream = (folder: string) => ({
            ...row('Lecture'),
            url: `http://h.example/series/${folder}/index.m3u8`,
        });
        const idsByUrl = (rows: ReturnType<typeof stream>[]) =>
            Object.fromEntries(
                (
                    buildM3uSeriesCatalog(rows, 'pl-1')[0].seasons.get(1) ?? []
                ).map((episode) => [episode.channel.url, episode.id])
            );

        const before = idsByUrl([stream('a'), stream('b')]);
        const after = idsByUrl([stream('b'), stream('a')]);

        expect(after).toEqual(before);
        expect(new Set(Object.values(before)).size).toBe(2);
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
