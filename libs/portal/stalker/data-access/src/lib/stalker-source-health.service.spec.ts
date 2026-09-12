import { TestBed } from '@angular/core/testing';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerSourceHealthService } from './stalker-source-health.service';
import { StalkerSessionService } from './stalker-session.service';

describe('Stalker source health', () => {
    let request: jest.Mock;
    let ensureToken: jest.Mock;
    let service: StalkerSourceHealthService;
    const simple = {
        _id: 'a',
        portalUrl: 'https://portal.test/portal.php',
        macAddress: '00:1A:79:00:00:01',
    } as PlaylistMeta;
    const context = () => ({
        requestId: 'health',
        deadlineAt: Date.now() + 5000,
    });
    beforeEach(() => {
        request = jest.fn();
        ensureToken = jest.fn().mockResolvedValue({ token: 'existing' });
        TestBed.configureTestingModule({
            providers: [
                StalkerSourceHealthService,
                { provide: DataService, useValue: { sendIpcEvent: request } },
                { provide: StalkerSessionService, useValue: { ensureToken } },
            ],
        });
        service = TestBed.inject(StalkerSourceHealthService);
    });
    it('checks a simple portal without repair or catalog requests', async () => {
        request.mockResolvedValue({ js: { account_info: { status: 1 } } });
        expect((await service.check(simple, context())).state).toBe('active');
        expect(request).toHaveBeenCalledWith(
            'STALKER_REQUEST',
            expect.objectContaining({
                params: expect.objectContaining({ action: 'get_main_info' }),
                probe: expect.any(Object),
                silent: true,
            })
        );
    });
    it('only confirms explicit account status or expiry', async () => {
        request.mockResolvedValueOnce({ js: { account_info: { status: 0 } } });
        expect((await service.check(simple, context())).confirmedInactive).toBe(
            true
        );
        request.mockResolvedValueOnce({ js: { login: 'user' } });
        expect((await service.check(simple, context())).confirmedInactive).toBe(
            false
        );
    });
    it('times out only the health consumer while shared cold authentication continues', async () => {
        jest.useFakeTimers();
        try {
            let resolve!: (value: { token: string }) => void;
            const shared = new Promise<{ token: string }>((r) => {
                resolve = r;
            });
            ensureToken.mockReturnValue(shared);
            const full = { ...simple, isFullStalkerPortal: true };
            const check = service.check(full, context());
            jest.advanceTimersByTime(5000);
            await expect(check).rejects.toThrow('timeout');
            expect(ensureToken.mock.calls[0]).toHaveLength(1);
            resolve({ token: 'foreground-token' });
            await expect(shared).resolves.toEqual({
                token: 'foreground-token',
            });
            expect(request).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });
    it('does not send a new request after cancellation', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            service.check(simple, context(), controller.signal)
        ).rejects.toThrow('cancelled');
        expect(request).not.toHaveBeenCalled();
    });
});
