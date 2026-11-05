import { TestBed } from '@angular/core/testing';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    countSourcesByStatus,
    countSourcesByType,
    filterSources,
    matchesSourceQuery,
    orderFailingFirst,
    replacementAfterRemoval,
    SourceBucketOf,
} from './source-list';
import {
    SOURCES_VIEW_STORAGE_KEY,
    SourcesViewStateService,
} from './sources-view-state.service';

const base = { count: 0, importDate: '', autoRefresh: false };
const m3u: PlaylistMeta = {
    ...base,
    _id: 'm3u',
    title: 'Free TV',
    url: 'https://cdn.example/list.m3u',
};
const file: PlaylistMeta = { ...base, _id: 'file', title: 'local list' };
const xtream: PlaylistMeta = {
    ...base,
    _id: 'xtream',
    title: '',
    serverUrl: 'http://biggie.to:8080',
    username: 'joe',
    password: 'hunter2',
};
const stalker: PlaylistMeta = {
    ...base,
    _id: 'stalker',
    title: 'Portal',
    macAddress: '00:1A:79:00:00:01',
    portalUrl: 'http://portal.example/c/',
};
const all = [m3u, file, xtream, stalker];
const bucketOf: SourceBucketOf = (playlist) =>
    (({ m3u: 'ok', xtream: 'bad', stalker: 'ok' })[playlist._id] as
        'ok' | 'bad' | undefined) ?? null;

describe('source list filters', () => {
    it('combines type, status and query', () => {
        const ids = (
            type: 'all' | 'm3u',
            status: 'all' | 'ok' | 'bad',
            q = ''
        ) =>
            filterSources(all, { type, status }, q, bucketOf).map((p) => p._id);
        expect(ids('all', 'all')).toEqual(['m3u', 'file', 'xtream', 'stalker']);
        expect(ids('m3u', 'all')).toEqual(['m3u', 'file']);
        expect(ids('all', 'bad')).toEqual(['xtream']);
        // A local file has no status, so it is in neither status group.
        expect(ids('m3u', 'ok')).toEqual(['m3u']);
        expect(ids('all', 'all', 'portal')).toEqual(['stalker']);
    });

    it('finds a source by its host, not by its password', () => {
        expect(matchesSourceQuery(xtream, 'biggie')).toBe(true);
        expect(matchesSourceQuery(xtream, 'hunter2')).toBe(false);
        expect(matchesSourceQuery(m3u, 'FREE')).toBe(true);
    });

    it('counts each group within the other group’s choice', () => {
        expect(countSourcesByType(all, 'all', bucketOf)).toEqual({
            all: 4,
            m3u: 2,
            xtream: 1,
            stalker: 1,
        });
        expect(countSourcesByType(all, 'ok', bucketOf)).toEqual({
            all: 2,
            m3u: 1,
            xtream: 0,
            stalker: 1,
        });
        expect(countSourcesByStatus(all, 'all', bucketOf)).toEqual({
            all: 4,
            ok: 2,
            bad: 1,
        });
        expect(countSourcesByStatus(all, 'm3u', bucketOf)).toEqual({
            all: 2,
            ok: 1,
            bad: 0,
        });
    });

    it('puts failing sources first and keeps the order otherwise', () => {
        expect(orderFailingFirst(all, bucketOf).map((p) => p._id)).toEqual([
            'xtream',
            'm3u',
            'file',
            'stalker',
        ]);
    });
});

describe('replacementAfterRemoval', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id) => ({ _id: id }));
    const none = () => false;

    it('hands over to the next row, or the previous one at the end', () => {
        expect(replacementAfterRemoval(rows, 'b', none)?._id).toBe('c');
        expect(replacementAfterRemoval(rows, 'd', none)?._id).toBe('c');
        expect(replacementAfterRemoval([{ _id: 'a' }], 'a', none)).toBeNull();
    });

    it('skips rows that are leaving too', () => {
        const deleting = (row: { _id: string }) =>
            row._id === 'c' || row._id === 'd';
        expect(replacementAfterRemoval(rows, 'b', deleting)?._id).toBe('a');
        expect(
            replacementAfterRemoval(rows, 'a', (row) => row._id !== 'a')
        ).toBeNull();
    });
});

describe('SourcesViewStateService', () => {
    const create = () => {
        TestBed.configureTestingModule({
            providers: [SourcesViewStateService],
        });
        return TestBed.inject(SourcesViewStateService);
    };

    beforeEach(() => localStorage.clear());
    afterEach(() => TestBed.resetTestingModule());

    it('keeps the filters across a restart', () => {
        const state = create();
        state.setType('xtream');
        state.setStatus('bad');
        TestBed.resetTestingModule();
        expect(create().filter()).toEqual({ type: 'xtream', status: 'bad' });
    });

    it('resets both filters', () => {
        const state = create();
        state.setType('m3u');
        state.reset();
        expect(state.filter()).toEqual({ type: 'all', status: 'all' });
    });

    it('ignores unknown stored values', () => {
        localStorage.setItem(
            SOURCES_VIEW_STORAGE_KEY,
            JSON.stringify({ type: 'radio', status: 'maybe' })
        );
        expect(create().filter()).toEqual({ type: 'all', status: 'all' });
    });
});
