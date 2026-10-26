import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    initialData,
    lumaArtwork,
    lumaFeed,
    withLumaIds,
    type Media,
} from '@iptvnator/tv/util';
import { lumaChannelLogos, lumaPoster } from '@iptvnator/tv/data-access';
const item: Media = {
    id: 'movie-1',
    sourceId: 'source',
    providerId: 'provider',
    kind: 'movie',
    title: 'A film',
    poster: 'https://provider.test/poster?password=secret',
    raw: { url: 'https://provider.test/movie/user/password/1.mp4' },
};
function fixture() {
    const data = initialData();
    data.sources = [
        {
            id: 'source',
            provider: 'xtream',
            name: 'Private',
            url: 'https://provider.test',
            password: 'secret',
        },
    ];
    data.activeId = 'source';
    data.favorites = [item];
    data.history = [{ item, seconds: 60, duration: 120, updated: 1 }];
    return data;
}
test('Luma resolves older provider posters and uses exact library channel logos without sharing credentials', () => {
    const data = fixture();
    data.sources[0] = {
        id: 'source',
        name: 'Portal',
        provider: 'stalker',
        url: 'https://portal.test/stalker_portal/server/load.php',
    };
    const movie = {
        ...item,
        poster: undefined,
        year: '2020',
        raw: { screenshot_uri: '/stalker_portal/screenshots/100/film.jpg' },
    };
    const logos = lumaChannelLogos([
        {
            playlist: {
                items: [
                    {
                        name: 'Red Bull TV HD',
                        tvg: { logo: 'https://logos.test/redbull.png' },
                    },
                    {
                        name: 'Signed',
                        tvg: { logo: 'https://logos.test/a.png?token=secret' },
                    },
                ],
            },
        },
    ]);
    assert.equal(
        lumaPoster(movie, data, logos),
        'https://portal.test/stalker_portal/screenshots/100/film.jpg'
    );
    const channel = {
        ...item,
        kind: 'live' as const,
        poster: undefined,
        raw: {},
        title: ' RED   BULL TV HD ',
    };
    assert.equal(
        lumaPoster(channel, data, logos),
        'https://logos.test/redbull.png'
    );
    assert.equal(
        lumaPoster({ ...channel, title: 'Red Bull TV HD DE' }, data, logos),
        undefined
    );
    assert.equal(logos.has('signed'), false);
    for (const url of [
        'https://user:pass@logos.test/a.png',
        'file:///tmp/a.png',
        'https://logos.test/a.png?password=secret',
        'https://logos.test/stream.mp4',
    ])
        assert.equal(lumaArtwork(url), undefined);
    data.favorites = [movie];
    const feed = lumaFeed(withLumaIds(data), 0, (m) =>
        lumaPoster(m, data, logos)
    );
    assert.equal(feed.favorites[0].year, '2020');
    assert.equal(
        feed.favorites[0].poster,
        'https://portal.test/stalker_portal/screenshots/100/film.jpg'
    );
    data.sources[0].password = 'private-password';
    data.favorites[0].poster =
        'https://portal.test/covers/private-password/film.jpg';
    assert.equal(lumaFeed(withLumaIds(data)).favorites[0].poster, undefined);
    assert.equal(
        lumaArtwork(
            'https://portal.test/covers/private%2Dpassword/film.jpg',
            data.sources[0]
        ),
        undefined
    );
});
