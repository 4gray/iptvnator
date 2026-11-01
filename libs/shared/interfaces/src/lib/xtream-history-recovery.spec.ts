import {
    parseXtreamHistoryRecovery,
    xtreamHistoryRecoveryKey,
} from './xtream-history-recovery';

const valid = {
    version: 1,
    contentTypes: ['movie'],
    recentlyViewed: [
        { contentType: 'movie', xtreamId: 42, viewedAt: '2026-01-01' },
    ],
};

it('round-trips typed history and source-scoped keys', () => {
    expect(xtreamHistoryRecoveryKey('p')).toBe('xtream-history-recovery:p');
    expect(parseXtreamHistoryRecovery(JSON.stringify(valid))).toEqual(valid);
});

it.each([
    null,
    {},
    { ...valid, version: 2 },
    { ...valid, contentTypes: null },
    { ...valid, contentTypes: ['bad'] },
    { ...valid, recentlyViewed: null },
    { ...valid, cleared: false },
    { ...valid, removed: 'bad' },
    { ...valid, removed: [null] },
    { ...valid, removed: [{ contentType: 'bad', xtreamId: 1 }] },
    { ...valid, removed: [{ contentType: 'live', xtreamId: '1' }] },
    ...[
        null,
        { contentType: 'bad', xtreamId: 42, viewedAt: 'd' },
        { contentType: 'movie', xtreamId: '42', viewedAt: 'd' },
        { contentType: 'movie', xtreamId: 42, viewedAt: null },
        { contentType: 'movie', xtreamId: 42, viewedAt: '' },
    ].map((row) => ({ ...valid, recentlyViewed: [row] })),
])('fails closed for an unreadable journal: %j', (value) => {
    expect(() => parseXtreamHistoryRecovery(JSON.stringify(value))).toThrow();
});
