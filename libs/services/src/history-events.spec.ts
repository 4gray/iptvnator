import { TestBed } from '@angular/core/testing';
import {
    captureHistoryOwner,
    HISTORY_PLAYLIST_BRIDGE,
    XtreamHistoryOrder,
} from './history-events';
import { SourceActivityService } from './lib/source-activity.service';
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

it('orders a global history clear across sources even when a preceding write fails', async () => {
    const order = TestBed.inject(XtreamHistoryOrder);
    const activity = TestBed.inject(SourceActivityService);
    const release = activity.begin(['first-source']);
    const calls: string[] = [];
    const failed = order.run(
        ['first-source'],
        async () => {
            calls.push('first write');
            throw new Error('Synthetic history write failed');
        },
        'first-source'
    );
    const rejected = expect(failed).rejects.toThrow(
        'Synthetic history write failed'
    );
    try {
        await order.run('other-source', async () => {
            calls.push('unrelated write');
        });
        expect(calls).toEqual(['unrelated write']);
    } finally {
        release();
    }

    const clear = order.run(null, async () => {
        calls.push('clear history');
    });
    const afterClear = order.run('other-source', async () => {
        calls.push('next write');
    });

    await Promise.all([rejected, clear, afterClear]);
    expect(calls).toEqual([
        'unrelated write',
        'first write',
        'clear history',
        'next write',
    ]);
    expect(activity.isBusy('first-source')).toBe(false);
});
