import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { ParentalLockStore } from '@iptvnator/shared/interfaces';
import { ParentalLockExternalLaunches } from './parental-lock-external-launches';
import { ParentalLockLockStore } from './parental-lock-lock-store.service';
import { ParentalLockService } from './parental-lock.service';

describe('ParentalLockExternalLaunches', () => {
    const route = { url: '' };
    const active = signal(false);
    const lockSet = signal<ParentalLockStore>({});
    let launches: ParentalLockExternalLaunches;

    beforeEach(() => {
        route.url = '/workspace/playlists/source%20a/all';
        active.set(false);
        lockSet.set({});
        TestBed.configureTestingModule({
            providers: [
                { provide: Router, useValue: route },
                { provide: ParentalLockService, useValue: { active } },
                { provide: ParentalLockLockStore, useValue: { lockSet } },
            ],
        });
        launches = TestBed.inject(ParentalLockExternalLaunches);
    });

    it('preserves the source and published lock state through a delayed report', () => {
        const requestId = launches.register(launches.capture());
        route.url = '/workspace/playlists/source-b/all';
        active.set(true);
        lockSet.set({
            'source a': { m3u: ['Synthetic group'], stalker: [], xtream: [] },
        });
        launches.finish(requestId);

        expect(launches.take(requestId)).toEqual({
            sourceId: 'source a',
            openedLocked: false,
            lockKey: '[]',
        });
        expect(launches.take(requestId)).toBeUndefined();
    });

    it('uses an explicit source and consumes reports that arrive before the reply', () => {
        active.set(true);
        const requestId = launches.register(launches.capture('source-c'));

        expect(launches.take(requestId)).toEqual({
            sourceId: 'source-c',
            openedLocked: true,
            lockKey: '[]',
        });
        launches.finish(requestId);
        expect(launches.take(requestId)).toBeUndefined();
    });

    it('bounds completed requests while preserving launches still in flight', () => {
        route.url = '/workspace/favorites';
        const context = launches.capture();
        expect(context.sourceId).toBeNull();
        const pending = launches.register(context);
        const completed = Array.from({ length: 65 }, () => {
            const requestId = launches.register(context);
            launches.finish(requestId);
            return requestId;
        });

        expect(launches.take(completed[0])).toBeUndefined();
        expect(launches.take(completed[64])).toBe(context);
        expect(launches.take(pending)).toBe(context);
    });
});
