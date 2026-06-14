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
        const injector = createEnvironmentInjector(
            [
                {
                    provide: DataService,
                    useValue: dataService,
                },
            ],
            Injector.NULL as unknown as EnvironmentInjector
        );

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

    it('normalizes full playlist URLs and trims copied credentials before checking status', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            payload: {
                user_info: {
                    auth: 1,
                    status: 'Active',
                    exp_date: '0',
                },
            },
        });

        const status = await service.checkPortalStatus(
            ' https://example.com/get.php?username=old&password=old&type=m3u_plus ',
            ' user ',
            ' pass '
        );

        expect(status).toBe('active');
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            'XTREAM_REQUEST',
            expect.objectContaining({
                url: 'https://example.com',
                params: {
                    action: 'get_account_info',
                    password: 'pass',
                    username: 'user',
                },
            })
        );
    });

    it('reads cached status with the same normalized connection key used by checks', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            payload: {
                user_info: {
                    auth: 1,
                    exp_date: '0',
                    status: 'Active',
                },
            },
        });

        await service.checkPortalStatus(
            ' https://example.com/get.php?username=old&password=old&type=m3u_plus ',
            ' user ',
            ' pass '
        );

        expect(
            service.getCachedStatus(
                ' https://example.com/get.php?username=old&password=old&type=m3u_plus ',
                ' user ',
                ' pass '
            )
        ).toBe('active');
    });

    it('falls back to alternate account actions when get_account_info does not return user info', async () => {
        dataService.sendIpcEvent.mockImplementation(
            async (_type: string, payload: unknown) => {
                const action = (
                    payload as {
                        params: { action?: string };
                    }
                ).params.action;

                if (action === 'get_profile') {
                    return {
                        payload: {
                            user_info: {
                                auth: 1,
                                exp_date: '0',
                            },
                        },
                    };
                }

                return { payload: { server_info: {} } };
            }
        );

        await expect(
            service.checkPortalStatus('https://example.com', 'user', 'pass')
        ).resolves.toBe('active');

        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(3);
        expect(dataService.sendIpcEvent).toHaveBeenNthCalledWith(
            2,
            'XTREAM_REQUEST',
            expect.objectContaining({
                params: {
                    password: 'pass',
                    username: 'user',
                },
            })
        );
        expect(dataService.sendIpcEvent).toHaveBeenNthCalledWith(
            3,
            'XTREAM_REQUEST',
            expect.objectContaining({
                params: {
                    action: 'get_profile',
                    password: 'pass',
                    username: 'user',
                },
            })
        );
    });

    it('treats lowercase active status and exp_date 0 as active', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            payload: {
                user_info: {
                    auth: 1,
                    exp_date: '0',
                    status: 'active',
                },
            },
        });

        await expect(
            service.checkPortalStatus('https://example.com', 'user', 'pass')
        ).resolves.toBe('active');
    });
});
