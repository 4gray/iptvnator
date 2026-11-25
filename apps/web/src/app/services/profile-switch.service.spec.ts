import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { PlaylistsService } from '@iptvnator/services';
import { observeActivityChanges } from '@iptvnator/services/activity-changes';
import {
    activePersonalScope,
    setActivePersonalScope,
} from '@iptvnator/services/profiles';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';
import { ActivitySyncRuntime } from './activity-sync-runtime';
import { FavoritesSyncRuntime } from './favorites-sync-runtime';
import { HistorySyncRuntime } from './history-sync-runtime';
import { ProfileSwitchService } from './profile-switch.service';
import { ProfilesRuntime } from './profiles-runtime';

const KIDS: PersonalScope = 'profile:11111111-1111-4111-8111-111111111111';

function setup() {
    const log: string[] = [];
    const note = (name: string) => () => {
        log.push(`${name}@${activePersonalScope()}`);
        return Promise.resolve();
    };
    const activity = {
        refresh: jest.fn(note('activity.refresh')),
        client: {
            flush: jest.fn(note('activity.flush')),
            stopDelivery: jest.fn(note('activity.stop')),
        },
    };
    const favorites = {
        refresh: jest.fn(note('favorites.refresh')),
        project: jest.fn(async (p: unknown) => p),
        client: { flush: jest.fn(note('favorites.flush')) },
    };
    const history = {
        refresh: jest.fn(note('history.refresh')),
        client: {
            contexts: new Map([
                ['a', {}],
                ['b', {}],
            ]),
            flush: jest.fn((id: string) => note(`history.flush.${id}`)()),
        },
    };
    const dispatch = jest.fn();
    const scope = signal<PersonalScope>('shared');
    TestBed.configureTestingModule({
        providers: [
            { provide: ProfilesRuntime, useValue: { scope } },
            { provide: ActivitySyncRuntime, useValue: activity },
            { provide: FavoritesSyncRuntime, useValue: favorites },
            { provide: HistorySyncRuntime, useValue: history },
            { provide: PlaylistsService, useValue: {} },
            { provide: Router, useValue: { url: '/workspace' } },
            { provide: Store, useValue: { dispatch } },
        ],
    });
    const events: string[] = [];
    for (const name of [
        'iptvnator-profile-switched',
        'iptvnator-history-changed',
        'iptvnator-favorites-changed',
    ])
        window.addEventListener(name, () =>
            events.push(`${name}@${activePersonalScope()}`)
        );
    const stop = observeActivityChanges(() =>
        events.push(`activity-changed@${activePersonalScope()}`)
    );
    return {
        service: TestBed.inject(ProfileSwitchService),
        log,
        events,
        dispatch,
        scope,
        activity,
        stop,
    };
}

afterEach(() => setActivePersonalScope('shared'));

describe('ProfileSwitchService', () => {
    it('does nothing when the scope is already active', async () => {
        const { service, log, dispatch, stop } = setup();
        await service.apply('shared');
        expect(log).toEqual([]);
        expect(dispatch).not.toHaveBeenCalled();
        stop();
    });

    it('drains the old scope, rescopes, re-lists every domain and announces the change', async () => {
        const { service, log, events, dispatch, stop } = setup();
        await service.apply(KIDS);
        const drained = [
            'activity.flush@shared',
            'activity.stop@shared',
            'favorites.flush@shared',
            'history.flush.a@shared',
            'history.flush.b@shared',
        ];
        // Everything owed under the old scope is sent before the scope moves.
        expect(log.slice(0, 3)).toEqual(
            expect.arrayContaining([
                'activity.refresh@shared',
                'favorites.refresh@shared',
                'history.refresh@shared',
            ])
        );
        expect(log.slice(3, 3 + drained.length)).toEqual(drained);
        const after = log.slice(3 + drained.length);
        expect(after).toEqual(
            expect.arrayContaining([
                `activity.refresh@${KIDS}`,
                `favorites.refresh@${KIDS}`,
                `history.refresh@${KIDS}`,
            ])
        );
        expect(events[0]).toBe(`iptvnator-profile-switched@${KIDS}`);
        expect(events).toEqual(
            expect.arrayContaining([
                `iptvnator-history-changed@${KIDS}`,
                `iptvnator-favorites-changed@${KIDS}`,
                `activity-changed@${KIDS}`,
            ])
        );
        // Shared playlists reload so the open playlist is projected again.
        expect(dispatch).toHaveBeenCalled();
        stop();
    });

    it('follows the active profile and runs one switch at a time', async () => {
        const { service, log, scope, stop } = setup();
        const first = service.apply(KIDS);
        const second = service.apply('shared');
        await Promise.all([first, second]);
        expect(activePersonalScope()).toBe('shared');
        const flushes = log.filter((entry) =>
            entry.startsWith('activity.flush')
        );
        // The first switch gave way: it never reached the kids scope.
        expect(flushes).toEqual(['activity.flush@shared']);
        scope.set(KIDS);
        TestBed.tick();
        await service.apply(KIDS);
        expect(activePersonalScope()).toBe(KIDS);
        stop();
    });
});
