import {
    EnvironmentInjector,
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
} from '@angular/core';
import { DataService } from './data.service';
import { PortalStatusService } from './portal-status.service';

describe('PortalStatusService', () => {
    let service: PortalStatusService;
    let dataService: { sendIpcEvent: jest.Mock };

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        const injector = createEnvironmentInjector([
            {
                provide: DataService,
                useValue: dataService,
            },
        ], Injector.NULL as unknown as EnvironmentInjector);

        service = runInInjectionContext(
            injector,
            () => new PortalStatusService()
        );
    });

    it('marks portal status checks as silent background probes', async () => {
        const futureExpDate = String(
            Math.floor(Date.now() / 1000) + 60 * 60 * 24
        );
        dataService.sendIpcEvent.mockResolvedValue({
            payload: {
                user_info: {
                    status: 'Active',
                    exp_date: futureExpDate,
                },
            },
        });

        const status = await service.checkPortalStatus(
            'http://example.com',
            'user',
            'pass'
        );

        expect(status).toBe('active');
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            'XTREAM_REQUEST',
            expect.objectContaining({
                suppressErrorLog: true,
                url: 'http://example.com',
                params: {
                    action: 'get_account_info',
                    password: 'pass',
                    username: 'user',
                },
            })
        );
    });

    it('returns unavailable without console noise when the portal is offline', async () => {
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        dataService.sendIpcEvent.mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(
            service.checkPortalStatus('http://example.com', 'user', 'pass')
        ).resolves.toBe('unavailable');
        expect(consoleErrorSpy).not.toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });
});
