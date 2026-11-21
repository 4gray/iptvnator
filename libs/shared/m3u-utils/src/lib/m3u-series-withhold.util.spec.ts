import { buildM3uSeriesCatalog } from './m3u-series-aggregate.util';
import { withholdM3uSeriesGroups } from './m3u-series-withhold.util';

const row = (name: string, group: string, file: string) => ({
    name,
    url: `http://h.example/series/u/p/${file}.mp4`,
    group: { title: group },
});

describe('withholdM3uSeriesGroups', () => {
    const series = buildM3uSeriesCatalog(
        [
            row('Harbor Lights S01E01', 'Shows', 'a'),
            row('Harbor Lights S01E02', 'Locked', 'b'),
            row('Harbor Lights S02E01', 'Locked', 'c'),
            row('Quiet Archive S01E01', 'Locked', 'd'),
        ],
        'pl-1'
    );

    it('returns the list untouched when nothing is withheld', () => {
        expect(withholdM3uSeriesGroups(series, null)).toBe(series);
    });

    it('drops withheld episodes, empty seasons and empty series', () => {
        const visible = withholdM3uSeriesGroups(series, new Set(['Locked']));

        expect(visible.map((entry) => entry.title)).toEqual(['Harbor Lights']);
        const [show] = visible;
        expect([...show.seasons.keys()]).toEqual([1]);
        expect(show.episodeCount).toBe(1);
        expect(show.groups).toEqual(['Shows']);
        expect(show.primaryGroup).toBe('Shows');
    });

    it('keeps the ids the full catalog minted', () => {
        // Ids key watch history; locking a group must not move them.
        const full = series[0].seasons.get(1)?.[0].id;
        const visible = withholdM3uSeriesGroups(series, new Set(['Locked']));

        expect(visible[0].seasons.get(1)?.[0].id).toBe(full);
    });

    it('plays an unlocked copy of an episode whose first copy is locked', () => {
        // One stream listed in two groups is one episode with the second
        // copy as an alternative; locking the first copy's group must not
        // hide the copy the viewer may still open.
        const shared = 'http://h.example/series/u/p/shared.mp4';
        const catalog = buildM3uSeriesCatalog(
            [
                { ...row('Lantern Street S01E01', 'Locked', 'x'), url: shared },
                { ...row('Lantern Street S01E01', 'Shows', 'x'), url: shared },
            ],
            'pl-1'
        );
        const id = catalog[0].seasons.get(1)?.[0].id;

        const [show] = withholdM3uSeriesGroups(catalog, new Set(['Locked']));
        const episode = show.seasons.get(1)?.[0];

        expect(episode?.channel.group.title).toBe('Shows');
        expect(episode?.alternatives).toEqual([]);
        expect(episode?.id).toBe(id);
    });

    it('drops only the withheld copy when the copy shown is not locked', () => {
        const shared = 'http://h.example/series/u/p/shared.mp4';
        const catalog = buildM3uSeriesCatalog(
            [
                { ...row('Lantern Street S01E01', 'Shows', 'x'), url: shared },
                { ...row('Lantern Street S01E01', 'Locked', 'x'), url: shared },
            ],
            'pl-1'
        );
        expect(catalog[0].seasons.get(1)?.[0].alternatives).toHaveLength(1);

        const [show] = withholdM3uSeriesGroups(catalog, new Set(['Locked']));
        const episode = show.seasons.get(1)?.[0];

        expect(episode?.channel.group.title).toBe('Shows');
        expect(episode?.alternatives).toEqual([]);
    });

    it('treats a row with no group as the empty group', () => {
        const catalog = buildM3uSeriesCatalog(
            [
                {
                    name: 'Harbor Lights S01E01',
                    url: 'http://h.example/series/u/p/n.mp4',
                },
            ],
            'pl-1'
        );

        expect(withholdM3uSeriesGroups(catalog, new Set(['']))).toEqual([]);
        expect(withholdM3uSeriesGroups(catalog, new Set(['Locked']))).toEqual(
            catalog
        );
    });

    it('withholds every series when the lock store cannot be read', () => {
        expect(withholdM3uSeriesGroups(series, 'all')).toEqual([]);
    });
});
