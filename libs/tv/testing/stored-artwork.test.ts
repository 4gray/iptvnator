import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedMediaPoster } from '@iptvnator/tv/data-access';
import { Media, Source } from '@iptvnator/tv/util';
test('old Stalker artwork is recovered without mutating identity, command or saved progress; foreign sources cannot resolve it', () => {
    const source: Source = {
        id: 'source',
        provider: 'stalker',
        name: 'Test',
        url: 'https://portal.example/c/',
    };
    const item: Media = {
        id: 'stable',
        sourceId: source.id,
        providerId: '42',
        kind: 'movie',
        title: 'Saved movie',
        poster: '',
        raw: { cover: '', screenshot_uri: '/covers/42.jpg', cmd: 'original' },
    };
    const before = JSON.stringify(item);
    assert.equal(
        storedMediaPoster(item, source),
        'https://portal.example/covers/42.jpg'
    );
    assert.equal(JSON.stringify(item), before);
    assert.equal(
        storedMediaPoster(item, { ...source, id: 'another' }),
        undefined
    );
    assert.equal(storedMediaPoster(item), undefined);
    assert.equal(
        storedMediaPoster(
            { ...item, poster: 'https://cdn.example/new.jpg' },
            source
        ),
        'https://cdn.example/new.jpg'
    );
});
