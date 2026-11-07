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

test('previous channel toggles only distinct confirmed channels and validates source/account ownership', () => {
    const session = new util.ConfirmedLiveChannels();
    const one = channel(a, '1'),
        two = channel(b, '1');
    assert.equal(
        session.previous([a, b]),
        undefined,
        'startup does not autoplay or invent a current channel'
    );
    session.confirm(one, [a, b]);
    assert.equal(session.previous([a, b]), undefined);
    // Requesting or failing B does not call confirm and cannot change the pair.
    assert.equal(session.previous([a, b]), undefined);
    session.confirm(two, [a, b]);
    assert.deepEqual(session.previous([a, b]), one);
    session.confirm(two, [a, b]);
    assert.deepEqual(
        session.previous([a, b]),
        one,
        'repeated playing preserves previous'
    );
    session.confirm(one, [a, b]);
    assert.deepEqual(session.previous([a, b]), two);
    session.confirm(two, [a, b]);
    assert.deepEqual(session.previous([a, b]), one);
    assert.equal(
        session.previous([b]),
        undefined,
        'removed source is unavailable'
    );
    assert.equal(
        session.previous([{ ...a, username: 'different-account' }, b]),
        undefined
    );
    session.confirm(channel({ ...a, id: 'removed' }, '2'), [a, b]);
    assert.deepEqual(
        session.previous([a, b]),
        one,
        'obsolete confirmation cannot poison the pair'
    );
    session.confirm({ ...one, kind: 'movie' }, [a, b]);
    assert.deepEqual(
        session.previous([a, b]),
        one,
        'VOD activity is independent'
    );
});

test('a new confirmation keeps the last valid distinct channel when the newer source changes', () => {
    const one = channel(a, '1');
    const two = channel(b, '2');
    const three = channel(a, '3');
    for (const sources of [[a], [a, { ...b, username: 'edited-account' }]]) {
        const session = new util.ConfirmedLiveChannels();
        session.confirm(one, [a, b]);
        session.confirm(two, [a, b]);
        session.confirm(three, sources);
        assert.deepEqual(session.previous(sources), one);
        session.confirm(one, sources);
        assert.deepEqual(session.previous(sources), three);
    }
    const session = new util.ConfirmedLiveChannels();
    session.confirm(one, [a, b]);
    session.confirm(two, [a, b]);
    session.confirm(one, [a]);
    assert.equal(session.previous([a]), undefined);
});
