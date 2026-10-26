import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedMediaPoster } from '@iptvnator/tv/data-access';
import {
    continueWatching,
    initialData,
    hydrateUserData,
    recordProgress,
    Progress,
    recoverSeriesContext,
    mediaTitle,
    seriesForEpisode,
    withSeriesContext,
} from '@iptvnator/tv/util';
const progress = (
    id: string,
    updated: number,
    extra: Partial<Progress> = {}
): Progress => ({
    item: {
        id,
        sourceId: 'a',
        providerId: id,
        kind: 'movie',
        title: id,
        raw: {},
    },
    seconds: 1200,
    duration: 3600,
    updated,
    ...extra,
});
test('historical episodes gain their exact parent title without changing identity, resume or commands', () => {
    const data = initialData();
    data.activeId = 'a';
    const saved = progress('ep', 42);
    saved.item = {
        ...saved.item,
        kind: 'episode',
        title: 'Episode 1',
        parentId: 'show',
        season: 1,
        episode: 1,
        raw: { cmd: 'unchanged-command', series: 1 },
    };
    data.history = [saved];
    data.positions.ep = saved;
    data.favorites = [saved.item];
    const parent = {
        ...saved.item,
        id: 'show',
        kind: 'series' as const,
        title: 'Ted Lasso s04',
        year: '2026',
        poster: 'https://example.test/show.jpg',
    };
    assert.equal(
        recoverSeriesContext(data, [{ ...parent, sourceId: 'other' }]),
        data
    );
    const next = recoverSeriesContext(data, [parent]);
    assert.equal(mediaTitle(next.history[0].item), 'Ted Lasso s04');
    assert.equal(next.history[0].item.title, 'Episode 1');
    assert.equal(next.positions.ep.seconds, saved.seconds);
    assert.equal(next.positions.ep.updated, 42);
    assert.equal(next.positions.ep.item.raw, saved.item.raw);
    assert.equal(next.favorites[0].seriesTitle, parent.title);
    assert.equal(next.favorites[0].id, saved.item.id);
    assert.equal(recoverSeriesContext(next, [parent]), next);
    assert.equal(data.history[0], saved);
});
test('saved parent context survives JSON storage without copying cached episode lists or accepting foreign parents', () => {
    const parent = {
        ...progress('show', 1).item,
        kind: 'series' as const,
        title: 'Series title',
        raw: {
            origin: 'vod',
            is_series: true,
            series: [1, 2],
            cmd: 'parent-command',
            details: { episodes: ['large cached list'] },
        },
    };
    const episode = {
        ...progress('episode', 2).item,
        kind: 'episode' as const,
        title: 'Episode title',
        parentId: parent.id,
        raw: { cmd: 'episode-command' },
    };
    const saved = withSeriesContext(episode, parent);
    const restored = JSON.parse(JSON.stringify(saved));
    const restoredParent = seriesForEpisode(restored);
    assert.equal(restoredParent?.title, parent.title);
    assert.equal(restoredParent?.providerId, parent.providerId);
    assert.deepEqual(restoredParent?.raw, {
        origin: 'vod',
        is_series: true,
        series: [1, 2],
        cmd: 'parent-command',
    });
    assert.equal(saved.raw, episode.raw);
    assert.equal(withSeriesContext(saved, parent), saved);
    assert.equal(seriesForEpisode({ ...saved, parentId: 'other' }), undefined);
    assert.equal(
        seriesForEpisode({ ...saved, sourceId: 'foreign' }),
        undefined
    );
    assert.equal(
        withSeriesContext(episode, { ...parent, sourceId: 'foreign' }),
        episode
    );
});
test('continuation is source-scoped, newest first, limited and never mutates saved history', () => {
    const data = initialData();
    data.activeId = 'a';
    const foreign = progress('foreign', 100);
    foreign.item.sourceId = 'b';
    const live = progress('live', 101);
    live.item.kind = 'live';
    data.history = [
        progress('old', 1),
        progress('done', 9, { seconds: 3590 }),
        progress('new', 3),
        foreign,
        live,
        progress('unknown-duration', 2, { duration: 0 }),
        progress('not-started', 8, { seconds: 0 }),
    ];
    const saved = JSON.stringify(data);
    assert.deepEqual(
        continueWatching(data, 3).map((p) => p.item.id),
        ['new', 'unknown-duration', 'old']
    );
    assert.deepEqual(
        continueWatching(data, 1).map((p) => p.item.id),
        ['new']
    );
    assert.equal(JSON.stringify(data), saved);
});
test('one latest episode per series; completed latest episode cannot revive an older unfinished episode', () => {
    const data = initialData();
    data.activeId = 'a';
    const episodes = ['e1', 'e2', 'e3', 'other'].map((id, i) => {
        const p = progress(id, i + 1);
        p.item.kind = 'episode';
        p.item.parentId = id === 'other' ? 'series-b' : 'series-a';
        return p;
    });
    data.history = episodes;
    assert.deepEqual(
        continueWatching(data).map((p) => p.item.id),
        ['other', 'e3']
    );
    episodes[2].seconds = 3590;
    assert.deepEqual(
        continueWatching(data).map((p) => p.item.id),
        ['other']
    );
    delete episodes[0].item.parentId;
    assert.deepEqual(
        continueWatching(data).map((p) => p.item.id),
        ['other', 'e1']
    );
});

test('sparse parent repair retains validated series metadata and remains idempotent', () => {
    const parent = {
        ...progress('show', 1).item,
        kind: 'series' as const,
        year: '2020',
        description: 'Saved series overview',
        backdrop: 'https://artwork.test/series-wide.jpg',
        poster: 'https://artwork.test/series-poster.jpg',
    };
    const episode = {
        ...progress('episode', 1).item,
        kind: 'episode' as const,
        parentId: parent.id,
        description: 'Episode overview',
        backdrop: 'https://artwork.test/legacy-episode-still.jpg',
        poster: 'https://artwork.test/legacy-episode-still.jpg',
    };
    const saved = withSeriesContext(episode, parent);
    const sparse = {
        ...parent,
        year: undefined,
        description: undefined,
        backdrop: undefined,
        poster: undefined,
    };
    const repaired = withSeriesContext(saved, sparse);
    assert.equal(repaired.parentSeries?.year, parent.year);
    assert.equal(repaired.parentSeries?.description, parent.description);
    assert.equal(repaired.description, episode.description);
    assert.equal(repaired.parentSeries?.backdrop, parent.backdrop);
    assert.equal(repaired.parentSeries?.poster, parent.poster);
    assert.equal(
        storedMediaPoster(repaired, undefined, [sparse]),
        parent.poster
    );
    assert.equal(
        storedMediaPoster(repaired, undefined, [
            { ...parent, poster: 'https://artwork.test/new-parent-poster.jpg' },
        ]),
        'https://artwork.test/new-parent-poster.jpg'
    );
    assert.equal(repaired.backdrop, episode.backdrop);
    assert.equal(withSeriesContext(repaired, sparse), repaired);
    assert.equal(
        withSeriesContext(repaired, {
            ...parent,
            backdrop: 'https://artwork.test/new-series-wide.jpg',
        }).parentSeries?.backdrop,
        'https://artwork.test/new-series-wide.jpg'
    );
    const foreign = {
        ...saved,
        parentSeries: { ...parent, sourceId: 'foreign' },
    };
    assert.equal(
        withSeriesContext(foreign, sparse).parentSeries?.backdrop,
        undefined
    );
    assert.equal(storedMediaPoster(foreign, undefined, [sparse]), undefined);
});

test('unknown saved fields survive hydration and subsequent progress writes', () => {
    const saved = {
        ...initialData(),
        retainedExtension: { value: 7, entries: ['keep'] },
    };
    const restored = hydrateUserData(saved);
    const updated = recordProgress(restored, progress('movie', 42));
    assert.deepEqual(
        JSON.parse(JSON.stringify(updated)).retainedExtension,
        saved.retainedExtension
    );
    assert.equal(updated.history[0].item.id, 'movie');
});
