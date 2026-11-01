import {
    parseActivityAddress,
    parseActivityOperation,
} from './activity-sync.wire';
import type {
    ActivityAddress,
    ActivityOperation,
} from './activity-sync.contract';

const address: ActivityAddress = {
    instanceId: 'synthetic-nas',
    scope: 'shared',
    sourceId: 'synthetic-source',
    sourceIncarnation: 'synthetic-generation',
    content: { provider: 'xtream', kind: 'vod', id: '42' },
};
const base = {
    operationId: 'synthetic-operation',
    deviceId: 'synthetic-device',
};

describe('activity wire boundary', () => {
    it.each([
        address.content,
        { provider: 'xtream', kind: 'episode', id: '42', seriesId: '7' },
        {
            provider: 'stalker',
            kind: 'episode',
            id: '42',
            seriesId: '7',
            mode: 'regular',
            seasonKey: 'synthetic-season',
            episodeNumber: 2,
        },
    ])('keeps only portable identity fields for %j', (content) => {
        const clean = { ...address, content };
        const incoming = {
            ...clean,
            password: 'synthetic-secret',
            content: { ...content, url: 'http://synthetic.invalid/private' },
        };
        expect(parseActivityAddress(incoming)).toEqual(clean);
    });

    it.each([
        { kind: 'begin', expectedRevision: 0, sessionId: 'synthetic-session' },
        { kind: 'reset', expectedRevision: 3 },
        { kind: 'mark-watched', expectedRevision: 4 },
        {
            kind: 'checkpoint',
            generation: 1,
            sessionId: 'synthetic-session',
            sequence: 1,
            resume: { positionSeconds: 25 },
        },
        {
            kind: 'checkpoint',
            generation: 1,
            sessionId: 'synthetic-session',
            sequence: 1,
            resume: { positionSeconds: 25, durationSeconds: 100 },
        },
        {
            kind: 'import',
            expectedRevision: 0,
            watched: false,
            resume: { positionSeconds: 25 },
        },
        {
            kind: 'import',
            expectedRevision: 0,
            watched: false,
            resume: { positionSeconds: 25, durationSeconds: 100 },
        },
        { kind: 'import', expectedRevision: 0, watched: true, resume: null },
    ])('round-trips %j while dropping credential fields', (fields) => {
        const operation = { ...base, ...fields } as ActivityOperation;
        expect(
            parseActivityOperation({
                ...operation,
                password: 'synthetic-secret',
            })
        ).toEqual(operation);
    });

    it.each([
        { contentXtreamId: 42 },
        {
            contentXtreamId: 42,
            title: 'Synthetic saved item',
            seriesXtreamId: 7,
            seasonNumber: 1,
            episodeNumber: 2,
        },
    ])(
        'retains safe display metadata and removes unknown fields',
        (positionMetadata) => {
            const operation = {
                ...base,
                kind: 'reset',
                expectedRevision: 0,
                positionMetadata,
            };
            expect(
                parseActivityOperation({
                    ...operation,
                    positionMetadata: {
                        ...positionMetadata,
                        password: 'synthetic-secret',
                    },
                })
            ).toEqual(operation);
        }
    );

    it.each([
        { contentXtreamId: -1 },
        { contentXtreamId: 42, title: 7 },
        { contentXtreamId: 42, title: 'x'.repeat(513) },
        { contentXtreamId: 42, seasonNumber: 0.5 },
        { contentXtreamId: 42, seriesXtreamId: Number.NaN },
    ])('rejects malformed metadata %j', (positionMetadata) => {
        expect(() =>
            parseActivityOperation({
                ...base,
                kind: 'reset',
                expectedRevision: 0,
                positionMetadata,
            })
        ).toThrow(
            'title' in positionMetadata
                ? 'Invalid activity title'
                : 'Invalid position metadata'
        );
    });
    it.each([
        { ...base, kind: 'unknown', expectedRevision: 0 },
        { ...base, kind: 'reset', expectedRevision: -1 },
        {
            ...base,
            kind: 'checkpoint',
            generation: 0,
            sessionId: 'synthetic-session',
            sequence: 1,
            resume: { positionSeconds: 1, durationSeconds: 0 },
        },
        {
            ...base,
            kind: 'import',
            expectedRevision: 0,
            watched: 'yes',
            resume: null,
        },
    ])('rejects malformed commands before storage', (operation) => {
        expect(() => parseActivityOperation(operation)).toThrow();
    });
});
