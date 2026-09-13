import { TestBed } from '@angular/core/testing';
import { PlaylistDeleteActionService } from '@iptvnator/services';
import {
    PlaylistMeta,
    SourceHealthSnapshot,
} from '@iptvnator/shared/interfaces';
import { SourceCleanupService } from './source-cleanup.service';
import { SourceHealthService } from './source-health.service';

const p = (id: string): PlaylistMeta =>
    ({ _id: id, title: id, url: `https://${id}.test/list` }) as PlaylistMeta;
const result = (
    state: 'expired' | 'active' | 'unavailable'
): SourceHealthSnapshot => ({
    state,
    reason:
        state === 'unavailable'
            ? 'timeout'
            : state === 'expired'
              ? 'expired'
              : 'available',
    confirmedInactive: state === 'expired',
    checkedAt: Date.now(),
});
describe('source cleanup', () => {
    let service: SourceCleanupService;
    let check: jest.Mock;
    let remove: jest.Mock;
    let removed: jest.Mock;
    let protectedIds: Set<string>;
    let current: Map<string, PlaylistMeta>;
    let health: {
        check: jest.Mock;
        recheck: jest.Mock;
        get: jest.Mock;
        invalidate: jest.Mock;
    };
    beforeEach(() => {
        check = jest.fn().mockResolvedValue(result('expired'));
        remove = jest.fn().mockResolvedValue({ success: true });
        removed = jest.fn();
        protectedIds = new Set();
        current = new Map();
        health = {
            check,
            recheck: check,
            get: jest.fn(),
            invalidate: jest.fn(),
        };
        TestBed.configureTestingModule({
            providers: [
                SourceCleanupService,
                { provide: SourceHealthService, useValue: health },
                {
                    provide: PlaylistDeleteActionService,
                    useValue: { deletePlaylistWithResult: remove },
                },
            ],
        });
        service = TestBed.inject(SourceCleanupService);
    });
    async function start(ids = ['a', 'b']) {
        ids.forEach((id) => current.set(id, p(id)));
        await service.start([...current.values()], {
            current: (id) => current.get(id),
            protected: (id) => protectedIds.has(id),
            removed,
        });
    }
    it('preselects confirmed accounts and leaves timeouts unchecked', async () => {
        check
            .mockResolvedValueOnce(result('expired'))
            .mockResolvedValueOnce(result('unavailable'));
        await start();
        expect(service.entries().map((e) => e.selected)).toEqual([true, false]);
        service.select('b', true);
        expect(service.entries()[1].selected).toBe(true);
    });
    it('clears automatic selection when newer evidence is uncertain', async () => {
        await start(['a']);
        health.get.mockReturnValue(result('unavailable'));
        await service.removeSelected();
        expect(remove).not.toHaveBeenCalled();
        expect(service.entries()[0]).toMatchObject({
            selected: false,
            health: { confirmedInactive: false },
        });
        service.select('a', true);
        await service.removeSelected();
        expect(remove).toHaveBeenCalledTimes(1);
    });
    it('removes all except the source unchecked by the user', async () => {
        await start();
        service.select('b', false);
        await service.removeSelected();
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledWith(p('a'));
        expect(removed).toHaveBeenCalledWith('a');
        expect(service.entries()[1].status).toBe('ready');
    });
    it('preserves unchecked choices on recheck and excludes recovered sources', async () => {
        await start();
        service.select('a', false);
        await service.recheck(service.entries()[0]);
        expect(service.entries()[0].selected).toBe(false);
        check.mockResolvedValueOnce(result('active'));
        await service.recheck(service.entries()[1]);
        expect(service.entries()[1].selected).toBe(false);
    });
    it('skips playing sources both at scan time and immediately before deletion', async () => {
        protectedIds.add('a');
        await start();
        protectedIds.add('b');
        await service.removeSelected();
        expect(remove).not.toHaveBeenCalled();
        expect(service.entries().every((e) => e.status === 'skipped')).toBe(
            true
        );
    });
    it('skips changed credentials and sources removed since the dialog opened', async () => {
        await start();
        current.set('a', { ...p('a'), userAgent: 'changed' });
        current.delete('b');
        await service.removeSelected();
        expect(remove).not.toHaveBeenCalled();
    });
    it.each(['stop', 'dispose'] as const)(
        'finishes only the current deletion on %s and prevents double submission',
        async (action) => {
            await start();
            let finish!: (value: { success: boolean }) => void;
            remove.mockImplementationOnce(
                () =>
                    new Promise((r) => {
                        finish = r;
                    })
            );
            const deleting = service.removeSelected();
            await service.removeSelected();
            service[action]();
            finish({ success: true });
            await deleting;
            expect(remove).toHaveBeenCalledTimes(1);
            expect(service.entries()[1].status).toBe('ready');
        }
    );
    it('isolates failures and reports post-delete warnings as deleted', async () => {
        await start();
        remove
            .mockRejectedValueOnce(new Error('DB failure'))
            .mockResolvedValueOnce({ success: true, cleanupWarnings: 1 });
        await service.removeSelected();
        expect(service.entries().map((e) => e.status)).toEqual([
            'failed',
            'deleted',
        ]);
        expect(service.entries()[1].warning).toBe(true);
        expect(removed).toHaveBeenCalledTimes(1);
    });
    it('requires confirmation again after refreshing stale evidence', async () => {
        check.mockResolvedValue({
            ...result('expired'),
            checkedAt: Date.now() - 310000,
        });
        await start();
        check.mockResolvedValue(result('expired'));
        await service.removeSelected();
        expect(remove).not.toHaveBeenCalled();
        expect(service.phase()).toBe('ready');
        await service.removeSelected();
        expect(remove).toHaveBeenCalledTimes(2);
    });
    it('does not preselect failed scans and cancels dialog-owned work on close', async () => {
        check.mockRejectedValue(new Error('network failure'));
        await start();
        expect(service.entries().every((e) => !e.selected)).toBe(true);
        service.dispose();
        expect(check.mock.calls[0][1].signal.aborted).toBe(true);
    });
});
