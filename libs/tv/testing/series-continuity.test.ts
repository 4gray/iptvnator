import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as tv from '@iptvnator/tv/util';
const parent: tv.Media = {
    id: 'show',
    sourceId: 'source',
    providerId: '42',
    kind: 'series',
    title: 'Synthetic story',
    raw: {},
};
const episode = (id: string, season: number, number: number): tv.Media =>
    tv.withSeriesContext(
        {
            ...parent,
            id,
            kind: 'episode',
            parentId: parent.id,
            season,
            episode: number,
            raw: { lazyEpisode: { episodeId: id } },
        },
        parent
    );
const episodes = [
    episode('extra', 0, 1),
    episode('a', 1, 1),
    episode('b', 1, 4),
    episode('c', 2, 1),
];
const save = (
    data: tv.UserData,
    item: tv.Media,
    seconds: number,
    updated: number
) => tv.recordProgress(data, { item, seconds, duration: 100, updated });
test('series actions use actual identities, latest activity, ordered seasons and exclude extras', () => {
    let data = tv.initialData();
    assert.equal(tv.seriesAction(parent, episodes, data)?.item.id, 'a');
    data = save(data, episodes[2], 20, 1);
    assert.equal(tv.seriesAction(parent, episodes, data)?.kind, 'resume');
    assert.equal(tv.seriesAction(parent, episodes, data)?.item.id, 'b');
    data = save(data, episodes[2], 90, 2);
    assert.equal(tv.seriesAction(parent, episodes, data)?.kind, 'next');
    assert.equal(tv.seriesAction(parent, episodes, data)?.item.id, 'c');
    assert.equal(tv.nextEpisode(episodes[2], episodes)?.id, 'c');
    data = save(data, episodes[3], 90, 3);
    assert.equal(tv.seriesAction(parent, episodes, data)?.kind, 'caught-up');
    data = save(data, episodes[0], 20, 4);
    assert.equal(tv.seriesAction(parent, episodes, data)?.kind, 'caught-up');
    assert.equal(tv.nextEpisode(episodes[3], episodes), undefined);
    assert.equal(
        tv.nextEpisode({ ...episodes[2], parentId: 'foreign' }, episodes),
        undefined
    );
    assert.equal(
        tv.seriesAction({ ...parent, sourceId: 'foreign' }, episodes, data),
        undefined
    );
    assert.equal(tv.seriesAction(parent, [], data), undefined);
});
test('known Home episode lists advance completion without reviving earlier gaps or removed sources', () => {
    let data = tv.initialData();
    data.sources = [
        {
            id: 'source',
            provider: 'xtream',
            name: 'Synthetic',
            url: 'https://example.test',
        },
    ];
    data = save(data, episodes[1], 20, 1);
    data = save(data, episodes[2], 90, 2);
    const lists = new Map([[parent.id, episodes]]);
    const next = tv.continueWatching(data, 8, lists);
    assert.equal(next[0]?.item.id, 'c');
    assert.equal(next[0]?.seconds, 0);
    assert.equal(next[0]?.item.raw, episodes[3].raw);
    assert.deepEqual(
        tv.continueWatching({ ...data, sources: [] }, 8, lists),
        []
    );
    data = save(data, episodes[3], 90, 3);
    assert.deepEqual(tv.continueWatching(data, 8, lists), []);
    data.sources = [];
    assert.deepEqual(tv.continueWatching(data, 8, lists), []);
});

test('latest partial wins over older completion; equal saves prefer later supplied order and extras-only runs work', () => {
    let data = tv.initialData();
    data = save(data, episodes[2], 90, 10);
    data = save(data, episodes[1], 20, 11);
    assert.equal(tv.seriesAction(parent, episodes, data)?.item.id, 'a');
    data = save(data, episodes[2], 20, 11);
    assert.equal(tv.seriesAction(parent, episodes, data)?.item.id, 'b');
    let complete = tv.initialData();
    for (const e of episodes) complete = save(complete, e, 90, 12);
    assert.equal(
        tv.seriesAction(parent, episodes, complete)?.kind,
        'caught-up'
    );
    const extras = [episode('bonus-a', 0, 2), episode('bonus-b', 0, 5)];
    assert.equal(
        tv.seriesAction(parent, extras, tv.initialData())?.item.id,
        'bonus-a'
    );
    assert.equal(tv.nextEpisode(extras[0], extras)?.id, 'bonus-b');
});

test('reset clears only the selected episode while Home can continue the remaining series activity', () => {
    let data = tv.initialData();
    data.sources = [
        {
            id: 'source',
            name: 'Synthetic',
            provider: 'xtream',
            url: 'https://example.test',
        },
    ];
    data = save(data, episodes[2], 90, 1);
    data = save(data, episodes[3], 20, 2);
    data = tv.setWatchState(data, episodes[3], 'reset', 3);
    const lists = new Map([[parent.id, episodes]]);
    assert.equal(tv.seriesAction(parent, episodes, data)?.item.id, 'c');
    assert.equal(tv.continueWatching(data, 8, lists)[0]?.item.id, 'c');
    const single = tv.setWatchState(
        save(
            { ...tv.initialData(), sources: data.sources },
            episodes[1],
            20,
            1
        ),
        episodes[1],
        'reset',
        2
    );
    assert.deepEqual(tv.continueWatching(single, 8, lists), []);
});
