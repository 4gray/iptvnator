import { TestBed } from '@angular/core/testing';
import { SourceHealthEvidenceService } from '@iptvnator/services';
import {
    SOURCE_HEALTH_HISTORY_STORAGE_KEY,
    SourceHealthHistoryService,
} from './source-health-history.service';

const failed = (checkedAt: number) => ({
    state: 'unavailable' as const,
    reason: 'network' as const,
    confirmedInactive: false,
    checkedAt,
});

describe('SourceHealthHistoryService', () => {
    const create = () => {
        TestBed.configureTestingModule({
            providers: [
                SourceHealthHistoryService,
                SourceHealthEvidenceService,
            ],
        });
        return TestBed.inject(SourceHealthHistoryService);
    };

    beforeEach(() => localStorage.clear());
    afterEach(() => TestBed.resetTestingModule());

    it('keeps the start of a failing run across a restart', () => {
        create().record(['a'], failed(100));
        TestBed.resetTestingModule();

        const restarted = create();
        restarted.record(['a'], failed(900));
        expect(restarted.entries().get('a')).toEqual({
            state: 'bad',
            checkedAt: 900,
            failingSince: 100,
            reason: 'network',
        });
    });

    it('stores no URL or credential', () => {
        create().record(['a'], failed(100));
        expect(localStorage.getItem(SOURCE_HEALTH_HISTORY_STORAGE_KEY)).toBe(
            '{"a":{"state":"bad","checkedAt":100,"failingSince":100,"reason":"network"}}'
        );
    });

    it('keeps the fingerprint of the checked connection, and starts over for another', () => {
        const history = create();
        history.record(['a'], failed(100), 'aaaa1111');
        history.record(['a'], failed(900), 'bbbb2222');
        expect(history.entries().get('a')).toEqual({
            state: 'bad',
            checkedAt: 900,
            failingSince: 900,
            reason: 'network',
            connection: 'bbbb2222',
        });
    });

    it('drops a stored cause this build cannot describe', () => {
        localStorage.setItem(
            SOURCE_HEALTH_HISTORY_STORAGE_KEY,
            '{"a":{"state":"bad","checkedAt":1,"reason":"<script>"},"b":{"state":"bad","checkedAt":1,"reason":"auth"}}'
        );
        const history = create();
        expect(history.entries().get('a')).toEqual({
            state: 'bad',
            checkedAt: 1,
        });
        expect(history.entries().get('b')?.reason).toBe('auth');
    });

    it('ignores inconclusive checks', () => {
        const history = create();
        history.record(['a'], {
            state: 'unavailable',
            reason: 'paused',
            confirmedInactive: false,
            checkedAt: 100,
        });
        expect(history.entries().size).toBe(0);
        expect(localStorage.getItem(SOURCE_HEALTH_HISTORY_STORAGE_KEY)).toBe(
            null
        );
    });

    it('forgets a deleted source and everything on a reset', () => {
        const history = create();
        const evidence = TestBed.inject(SourceHealthEvidenceService);
        history.record(['a', 'b'], failed(100));

        evidence.connections.next({ id: 'a' });
        expect([...history.entries().keys()]).toEqual(['b']);

        // An edit keeps the entry; the next check replaces it.
        evidence.connections.next({ id: 'b', playlist: { title: 'b' } });
        expect([...history.entries().keys()]).toEqual(['b']);

        evidence.connections.next({});
        expect(history.entries().size).toBe(0);
    });

    it('starts empty from unreadable storage', () => {
        localStorage.setItem(SOURCE_HEALTH_HISTORY_STORAGE_KEY, '{nope');
        expect(create().entries().size).toBe(0);
        localStorage.setItem(
            SOURCE_HEALTH_HISTORY_STORAGE_KEY,
            '{"a":{"state":"weird","checkedAt":1}}'
        );
        TestBed.resetTestingModule();
        expect(create().entries().size).toBe(0);
    });
});
