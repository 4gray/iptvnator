import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    buildSwitcherGroups,
    moveHighlight,
    readSwitcherType,
    SWITCHER_TYPE_STORAGE_KEY,
    writeSwitcherType,
} from './playlist-switcher-list';

const source = (id: string, fields: Partial<PlaylistMeta> = {}) =>
    ({
        _id: id,
        title: id,
        count: 0,
        importDate: '',
        autoRefresh: false,
        ...fields,
    }) as PlaylistMeta;

const many = [
    source('a', { url: 'http://a.example/list.m3u' }),
    source('b', {
        serverUrl: 'http://b.example',
        username: 'u',
        password: 'p',
    }),
    source('c', { macAddress: 'm', portalUrl: 'http://c.example/c/' }),
    source('d'),
    source('e'),
    source('f'),
];

describe('buildSwitcherGroups', () => {
    it('lists recent sources first, newest first, and all of them below', () => {
        const groups = buildSwitcherGroups(many, ['c', 'gone', 'a'], 'all', '');
        expect(groups.recent.map((o) => o.playlist._id)).toEqual(['c', 'a']);
        expect(groups.all).toHaveLength(6);
        expect(groups.recent[0].id).not.toBe(
            groups.all.find((o) => o.playlist._id === 'c')?.id
        );
    });

    it('hides Recent while searching and for a short list', () => {
        expect(buildSwitcherGroups(many, ['a'], 'all', 'b').recent).toEqual([]);
        expect(
            buildSwitcherGroups(many.slice(0, 3), ['a'], 'all', '').recent
        ).toEqual([]);
        // A long library filtered down to one type is a short list too.
        expect(buildSwitcherGroups(many, ['b'], 'xtream', '').recent).toEqual(
            []
        );
    });

    it('filters by type and by name or host', () => {
        expect(
            buildSwitcherGroups(many, [], 'xtream', '').all.map(
                (o) => o.playlist._id
            )
        ).toEqual(['b']);
        expect(
            buildSwitcherGroups(many, [], 'all', 'c.example').all.map(
                (o) => o.playlist._id
            )
        ).toEqual(['c']);
    });
});

describe('moveHighlight', () => {
    it('wraps at both ends and starts from either end', () => {
        expect(moveHighlight(-1, 1, 3)).toBe(0);
        expect(moveHighlight(-1, -1, 3)).toBe(2);
        expect(moveHighlight(2, 1, 3)).toBe(0);
        expect(moveHighlight(0, -1, 3)).toBe(2);
        expect(moveHighlight(1, 1, 0)).toBe(-1);
    });
});

describe('switcher type memory', () => {
    beforeEach(() => localStorage.clear());

    it('remembers the chosen type', () => {
        writeSwitcherType('stalker');
        expect(readSwitcherType()).toBe('stalker');
    });

    it('migrates the old checkboxes to one type or All', () => {
        localStorage.setItem(
            'playlist-switcher:type-filters',
            JSON.stringify({ m3u: false, stalker: false, xtream: true })
        );
        localStorage.setItem('playlist-switcher:search-query', 'old query');
        expect(readSwitcherType()).toBe('xtream');
        expect(localStorage.getItem(SWITCHER_TYPE_STORAGE_KEY)).toBe('xtream');
        expect(
            localStorage.getItem('playlist-switcher:type-filters')
        ).toBeNull();
        expect(
            localStorage.getItem('playlist-switcher:search-query')
        ).toBeNull();

        localStorage.clear();
        localStorage.setItem(
            'playlist-switcher:type-filters',
            JSON.stringify({ m3u: true, stalker: true, xtream: false })
        );
        expect(readSwitcherType()).toBe('all');
    });
});
