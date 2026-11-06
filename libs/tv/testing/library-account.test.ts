import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    initialData,
    identity,
    type Source,
    type UserData,
} from '@iptvnator/tv/util';
import { mergeLibrary } from '@iptvnator/tv/data-access';
const settings = {
    url: 'https://library.invalid',
    token: '',
    instanceId: 'server',
    originals: {},
    lastSync: 0,
};
const source: Source = {
    id: 'library-source',
    libraryId: 'row',
    name: 'Portal',
    provider: 'xtream',
    url: 'https://panel.invalid',
    username: 'first',
    password: 'secret',
};
function saved(s: Source): UserData {
    const item = {
        id: identity(s, 'movie', '10'),
        sourceId: s.id,
        providerId: '10',
        kind: 'movie' as const,
        title: 'Saved title',
        raw: {},
    };
    const progress = { item, seconds: 35, duration: 100, updated: 1 };
    return {
        ...initialData(),
        activeId: s.id,
        sources: [s],
        library: settings,
        favorites: [item],
        history: [progress],
        positions: { [item.id]: progress },
    };
}
for (const change of [
    { username: 'second' },
    { url: 'https://other.invalid' },
    { provider: 'm3u' as const, username: undefined },
]) {
    test(`changed server account separates saved media (${Object.keys(change)[0]})`, () => {
        const previous = saved(source);
        const incoming = { ...source, ...change };
        const next = mergeLibrary(previous, settings, [incoming]);
        assert.notEqual(next.activeId, source.id);
        assert.equal(next.sources[0].id, next.activeId);
        assert.deepEqual(next.favorites, previous.favorites);
        assert.deepEqual(next.history, previous.history);
        assert.deepEqual(next.positions, previous.positions);
        assert.notEqual(
            identity(next.sources[0], 'movie', '10'),
            previous.favorites[0].id
        );
        assert.equal(
            mergeLibrary(next, next.library!, [incoming]).activeId,
            next.activeId
        );
    });
}
test('a changed server account restores the original linked local source without reusing its media identity', () => {
    const local = { ...source, libraryId: undefined, password: 'original' };
    const data = saved(source);
    const library = { ...settings, originals: { [local.id]: local } };
    const next = mergeLibrary({ ...data, library }, library, [
        { ...source, username: 'second' },
    ]);
    assert.notEqual(next.activeId, local.id);
    assert.deepEqual(
        next.sources.find((s) => s.id === local.id),
        local
    );
    assert.equal(next.library?.originals[local.id], undefined);
    assert.deepEqual(next.favorites, data.favorites);
});
test('ordinary rename/password refresh and stored-file M3U updates preserve media identity', () => {
    const renamed = mergeLibrary(saved(source), settings, [
        { ...source, name: 'Renamed', password: 'new-password' },
    ]);
    assert.equal(renamed.activeId, source.id);
    const file: Source = {
        ...source,
        provider: 'm3u',
        url: '',
        m3uItems: [{ name: 'First', url: 'https://media.invalid/1.ts' }],
    };
    const refreshed = mergeLibrary(saved(file), settings, [
        {
            ...file,
            m3uItems: [{ name: 'Second', url: 'https://media.invalid/2.ts' }],
        },
    ]);
    assert.equal(refreshed.activeId, file.id);
});

test('changing a Stalker MAC isolates the account while retaining old saved state', () => {
    const portal: Source = {
        ...source,
        provider: 'stalker',
        url: 'https://portal.invalid/server/load.php',
        macAddress: '00:1A:79:00:00:01',
    };
    const previous = saved(portal);
    const next = mergeLibrary(previous, settings, [
        { ...portal, macAddress: '00:1A:79:00:00:02' },
    ]);
    assert.notEqual(next.activeId, portal.id);
    assert.deepEqual(next.favorites, previous.favorites);
    assert.deepEqual(next.positions, previous.positions);
});
