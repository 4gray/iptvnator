import { isStalkerSearchRequestCurrent } from './stalker-search-request.util';

describe('isStalkerSearchRequestCurrent', () => {
    const key = {
        search: 'family',
        contentType: 'vod',
        page: 2,
        playlistId: 'stalker-1',
        parentalLockVersion: 3,
    };

    it('accepts a response whose coordinates are unchanged', () => {
        expect(isStalkerSearchRequestCurrent(key, { ...key })).toBe(true);
    });

    it('rejects a response issued under an older parental lock version', () => {
        expect(
            isStalkerSearchRequestCurrent(key, {
                ...key,
                parentalLockVersion: 4,
            })
        ).toBe(false);
    });

    it.each([
        ['search', { search: 'famil' }],
        ['contentType', { contentType: 'series' }],
        ['page', { page: 3 }],
        ['playlistId', { playlistId: 'stalker-2' }],
    ])('rejects a response whose %s moved on', (_field, change) => {
        expect(isStalkerSearchRequestCurrent(key, { ...key, ...change })).toBe(
            false
        );
    });
});
