import { TestBed } from '@angular/core/testing';
import { captureHistoryOwner, HISTORY_PLAYLIST_BRIDGE } from './history-events';
import type { Playlist } from '@iptvnator/shared/interfaces';

afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
    localStorage.clear();
});

it('keeps ordinary local history usable without an active sync bridge', async () => {
    const bridge = TestBed.inject(HISTORY_PLAYLIST_BRIDGE);
    const playlist = { _id: 'synthetic-source' } as Playlist;
    expect(bridge.active()).toBe(false);
    expect(await bridge.project(playlist)).toBe(playlist);
    expect(await bridge.mutate(playlist, { kind: 'clear' })).toBeNull();
    expect(
        captureHistoryOwner(undefined, playlist._id, () => undefined)()
    ).toBe(true);
});

it('fences a delayed confirmation when its profile or source epoch changes', () => {
    let instance = 'synthetic-nas';
    const current = captureHistoryOwner(
        instance,
        'synthetic-source',
        () => instance
    );
    expect(current()).toBe(true);
    instance = 'synthetic-other';
    expect(current()).toBe(false);
    instance = 'synthetic-nas';
    localStorage.setItem(
        'iptvnator-server:synthetic-nas:history-source-epoch:synthetic-source',
        'replacement'
    );
    expect(current()).toBe(false);
});

it('withholds delayed confirmation if owner storage becomes unreadable', () => {
    const current = captureHistoryOwner(
        'synthetic-nas',
        'synthetic-source',
        () => 'synthetic-nas'
    );
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Synthetic unavailable storage');
    });
    expect(current()).toBe(false);
    expect(
        captureHistoryOwner(
            'synthetic-nas',
            'synthetic-source',
            () => 'synthetic-nas'
        )()
    ).toBe(false);
});
