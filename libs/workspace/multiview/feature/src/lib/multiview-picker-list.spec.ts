import { liveItem, movieItem } from './multiview-picker.fixtures';
import {
    listForType,
    nextActiveKey,
    rowsOf,
    searchGroups,
    sectionGroups,
    typeCounts,
} from './multiview-picker-list';
import { toPickerRow } from './multiview-picker-row';
import { EMPTY_PICKER_SEARCH } from './multiview-picker-search';

const live = toPickerRow(liveItem(1), []);
const film = toPickerRow(movieItem(2), []);
const show = toPickerRow(movieItem(3, { contentType: 'series' }), []);

describe('multiview picker list', () => {
    it('captions the Live now groups and leaves plain sections uncaptioned', () => {
        expect(
            sectionGroups({
                id: 'live-now',
                count: 2,
                groups: [
                    { id: 'from-favorites', rows: [live] },
                    { id: 'more-on-air', rows: [film] },
                ],
            }).map((group) => group.captionKey)
        ).toEqual([
            'PLAYER.MULTIVIEW.PICKER.GROUP_FROM_FAVORITES',
            'PLAYER.MULTIVIEW.PICKER.GROUP_MORE_ON_AIR',
        ]);
        expect(
            sectionGroups({
                id: 'recent',
                count: 1,
                groups: [{ id: 'all', rows: [live] }],
            })[0].captionKey
        ).toBeNull();
        expect(sectionGroups(undefined)).toEqual([]);
    });

    it('orders search groups and drops empty ones', () => {
        const groups = searchGroups({
            ...EMPTY_PICKER_SEARCH,
            series: [show],
            onAir: [live],
        });

        expect(groups.map((group) => group.id)).toEqual(['on-air', 'series']);
    });

    it('filters by type chip and counts every type once', () => {
        const groups = [
            { id: 'a', captionKey: null, rows: [live, film] },
            { id: 'b', captionKey: null, rows: [live, show] },
        ];

        expect(rowsOf(listForType(groups, 'live'))).toEqual([live, live]);
        expect(listForType(groups, 'movie').map((g) => g.id)).toEqual(['a']);
        expect(typeCounts(groups)).toEqual({
            all: 3,
            live: 1,
            movie: 1,
            series: 1,
        });
    });

    it('moves the active row with wrap-around', () => {
        const keys = ['a', 'b', 'c'];

        expect(nextActiveKey(keys, null, 1)).toBe('a');
        expect(nextActiveKey(keys, null, -1)).toBe('c');
        expect(nextActiveKey(keys, 'c', 1)).toBe('a');
        expect(nextActiveKey(keys, 'a', -1)).toBe('c');
        expect(nextActiveKey(keys, 'gone', 1)).toBe('a');
        expect(nextActiveKey([], 'a', 1)).toBeNull();
    });
});
