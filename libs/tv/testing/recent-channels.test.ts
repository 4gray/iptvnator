import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as util from '@iptvnator/tv/util';
import type { Media, Source } from '@iptvnator/tv/util';

const a: Source = {
    id: 'a',
    provider: 'xtream',
    name: 'Demo North',
    url: 'https://north.example',
};
const b: Source = { ...a, id: 'b', name: 'Demo South' };
const channel = (source: Source, id: string): Media => ({
    id: util.identity(source, 'live', id),
    sourceId: source.id,
    providerId: id,
    kind: 'live',
    title: `Demo channel ${id}`,
    raw: {},
});
const progress = (item: Media, updated: number) => ({
    item,
    updated,
    seconds: 0,
    duration: 0,
});

test('recent channels are newest-first, unique, source/provider scoped and bounded after JSON reload', () => {
    const data = util.initialData();
    data.sources = [a, b];
    const first = channel(a, '1');
    data.history = [
        progress(first, 1),
        progress(channel(b, '1'), 4),
        progress({ ...first, title: 'Updated demo title' }, 5),
        progress({ ...channel(a, 'film'), kind: 'movie' }, 8),
        progress(channel({ ...a, id: 'removed' }, '1'), 10),
        progress(channel({ ...a, provider: 'stalker' }, '1'), 11),
    ];
    const before = JSON.stringify(data);
    assert.deepEqual(
        util
            .recentChannels(util.hydrateUserData(JSON.parse(before)))
            .map((m) => m.title),
        ['Updated demo title', 'Demo channel 1']
    );
    assert.equal(
        JSON.stringify(data),
        before,
        'deriving recents does not touch VOD positions or history'
    );
    data.history = Array.from({ length: 20 }, (_, n) =>
        progress(channel(a, String(n)), n)
    );
    assert.deepEqual(
        util.recentChannels(data).map((m) => m.providerId),
        Array.from({ length: 12 }, (_, n) => String(19 - n))
    );
    assert.deepEqual(
        util.recentChannels(util.removeSourceData(data, a.id)),
        []
    );
});

test('Stalker Live recents retain the provider catalog prefix and raw playback command', () => {
    const source: Source = { ...a, provider: 'stalker' };
    const item: Media = {
        ...channel(source, '5'),
        id: util.identity(source, 'live', 'live:5'),
        raw: { cmd: 'https://stream.example/five.ts' },
    };
    const data = {
        ...util.initialData(),
        sources: [source],
        history: [progress(item, 1)],
    };
    assert.deepEqual(util.recentChannels(data), [item]);
});
