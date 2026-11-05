import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    detailChips,
    detailPeople,
    withSeriesContext,
    type Media,
} from '@iptvnator/tv/util';

const item: Media = {
    id: 'fixture:movie',
    sourceId: 'fixture',
    providerId: '42',
    title: 'Fixture Movie',
    kind: 'movie',
    raw: {},
};
const metadata: NonNullable<Media['metadata']> = {
    tmdbId: 701,
    authorRole: 'Directors',
    authors: [{ name: 'Fixture Director', tmdbPersonId: 20, profileUrl: null }],
    cast: [
        {
            name: 'Fixture Actor',
            tmdbPersonId: 10,
            character: 'Lead',
            profileUrl: null,
        },
        {
            name: ' fixture  director ',
            tmdbPersonId: 20,
            character: 'Cameo',
            profileUrl: null,
        },
        { name: 'Fixture Guest', profileUrl: null },
        { name: 'Fixture Actor Alias', tmdbPersonId: 10, profileUrl: null },
        { name: '   ', profileUrl: null },
    ],
};

test('saved series context keeps its named playlist category for episode-to-series details', () => {
    const parent: Media = {
        ...item,
        kind: 'series',
        category: '99',
        categoryName: 'Fixture Collection',
    };
    const episode: Media = {
        ...item,
        id: 'fixture:episode',
        kind: 'episode',
        parentId: parent.id,
    };
    const saved = withSeriesContext(episode, parent);
    const repaired = withSeriesContext(saved, {
        ...parent,
        category: undefined,
        categoryName: undefined,
    });
    assert.equal(repaired.parentSeries?.category, '99');
    assert.equal(repaired.parentSeries?.categoryName, 'Fixture Collection');
    assert.equal(repaired.id, episode.id);
    assert.equal(
        withSeriesContext(saved, {
            ...parent,
            category: '88',
            categoryName: undefined,
        }).parentSeries?.categoryName,
        undefined
    );
});

test('distinct TMDB identities keep separate filmography controls despite matching display names', () => {
    const people = detailPeople({
        ...item,
        metadata: {
            ...metadata,
            authors: [
                { name: 'Fixture Person', tmdbPersonId: 20, profileUrl: null },
            ],
            cast: [
                { name: 'fixture person', tmdbPersonId: 10, profileUrl: null },
                { name: 'Fixture Guest', profileUrl: null },
                { name: ' fixture  guest ', profileUrl: null },
            ],
        },
    });
    assert.deepEqual(
        people.map((person) => person.tmdbPersonId),
        [20, 10, undefined]
    );
});

test('Stalker genres_str supplies genre chips when TMDB and generic genre are absent', () => {
    assert.deepEqual(
        detailChips({
            ...item,
            kind: 'series',
            raw: {
                genre: '',
                genres_str: 'Fixture Adventure, Fixture Drama',
                country: 'Fixture Country',
            },
        }),
        [
            { label: 'Genre', value: 'Fixture Adventure' },
            { label: 'Genre', value: 'Fixture Drama' },
            { label: 'Country', value: 'Fixture Country' },
        ]
    );
});

test('one credits list puts authors first, keeps roles and removes duplicate people', () => {
    assert.deepEqual(detailPeople(item), []);
    const people = detailPeople({ ...item, metadata });
    assert.deepEqual(
        people.map((person) => [person.name, person.role]),
        [
            ['Fixture Director', 'Director'],
            ['Fixture Actor', 'Lead'],
            ['Fixture Guest', 'Actor'],
        ]
    );
    assert.equal(people[0].tmdbPersonId, 20);
    assert.equal(
        detailPeople({
            ...item,
            metadata: { ...metadata, authorRole: 'Creators' },
        })[0].role,
        'Creator'
    );
});

test('chips merge TMDB information with provider year and named playlist category', () => {
    const enriched = {
        ...item,
        year: '2020-03-04',
        category: '99',
        categoryName: 'Fixture Collection',
        metadata: {
            ...metadata,
            year: '2019',
            genres: ['Adventure', ' adventure ', '', 'Drama'],
            countries: ['Fictionland', 'Fictionland'],
            durationMinutes: 110,
            rating: 7.6,
        },
    };
    assert.deepEqual(detailChips(enriched), [
        { label: 'Year', value: '2020' },
        { label: 'Genre', value: 'Adventure' },
        { label: 'Genre', value: 'Drama' },
        { label: 'Country', value: 'Fictionland' },
        { label: 'Playlist category', value: 'Category · Fixture Collection' },
        { label: 'Duration', value: '110 min' },
        { label: 'TMDB rating', value: 'TMDB 7.6' },
    ]);
    assert.equal(
        detailChips({ ...enriched, kind: 'series' }).find(
            (chip) => chip.label === 'Duration'
        )?.value,
        '110 min / episode'
    );
    assert.equal(
        detailChips({ ...enriched, year: undefined })[0].value,
        '2019'
    );
});

test('year chips retain early release dates and numeric years while rejecting unknown years', () => {
    for (const year of ['1895', '1895-03-04', '2101'])
        assert.deepEqual(detailChips({ ...item, year }), [
            { label: 'Year', value: year.slice(0, 4) },
        ]);
    assert.deepEqual(
        detailChips({ ...item, metadata: { ...metadata, year: '1895' } }),
        [{ label: 'Year', value: '1895' }]
    );
    assert.deepEqual(
        detailChips({ ...item, raw: { details: { info: { year: 1895 } } } }),
        [{ label: 'Year', value: '1895' }]
    );
    for (const year of ['0000', 'N/A', 'unknown'])
        assert.deepEqual(detailChips({ ...item, year }), []);
});

test('empty detail country never masks an available catalog country', () => {
    for (const country of ['', 'N/A', 'unknown', null])
        assert.deepEqual(
            detailChips({
                ...item,
                raw: {
                    country: 'Fixture Country',
                    details: { info: { country } },
                },
            }),
            [{ label: 'Country', value: 'Fixture Country' }]
        );
});

test('provider-only and historical details omit internal category IDs and unavailable values', () => {
    assert.deepEqual(
        detailChips({
            ...item,
            raw: { genre: 'N/A / Adventure', country: 'Fixture Country' },
            metadata: { ...metadata, genres: [' '], countries: ['N/A'] },
        }),
        [
            { label: 'Genre', value: 'Adventure' },
            { label: 'Country', value: 'Fixture Country' },
        ]
    );
    assert.deepEqual(detailChips({ ...item, category: '99' }), []);
    assert.deepEqual(
        detailChips({
            ...item,
            year: 'N/A',
            raw: {
                details: {
                    info: {
                        releaseDate: '2021-01-01',
                        genre: 'Drama / Adventure; Drama',
                        country: 'Fixture Country',
                    },
                },
            },
        }),
        [
            { label: 'Year', value: '2021' },
            { label: 'Genre', value: 'Drama' },
            { label: 'Genre', value: 'Adventure' },
            { label: 'Country', value: 'Fixture Country' },
        ]
    );
    assert.deepEqual(
        detailChips({
            ...item,
            raw: { genre: 'N/A', country: 'unknown' },
            metadata: { ...metadata, durationMinutes: -1, rating: NaN },
        }),
        []
    );
    assert.deepEqual(
        detailChips({
            ...item,
            metadata: { ...metadata, durationMinutes: Infinity, rating: 12 },
        }),
        []
    );
});
