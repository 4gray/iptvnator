import { ipcMain } from 'electron';
import {
    HOSTED_DEVICE_CONTROL,
    type HostedServerStatus,
    type HostedWorkerRequest,
    type HostedWorkerResponse,
} from '@iptvnator/shared/interfaces';
import { registerHostedDeviceEvents } from './hosted-device-control';
import { setHostedServerSession } from './hosted-server-session';

jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));

describe('hosted device control', () => {
    const origin = 'https://library.example.test';
    const instanceId = 'synthetic-instance';
    const inviteId = 'i'.repeat(43);
    const claimId = 'c'.repeat(43);
    const deviceId = '12345678-1234-4123-8123-123456789abc';
    const expiresAt = '2030-01-01T00:00:00.000Z';
    const worker = jest.fn<
        Promise<HostedWorkerResponse>,
        [HostedWorkerRequest]
    >();
    let status: HostedServerStatus;
    const invoke = (command: unknown) =>
        jest.mocked(ipcMain.handle).mock.lastCall![1]({} as never, command);

    beforeEach(() => {
        jest.clearAllMocks();
        worker.mockReset().mockResolvedValue({ status: 204, body: undefined });
        status = {
            state: 'running',
            mode: 'cloudflare',
            endpoint: origin,
            publicRoute: 'access-protected',
        };
        setHostedServerSession({
            instanceId,
            code: 'synthetic-code',
            request: worker,
        });
        registerHostedDeviceEvents(
            jest.fn(),
            () => status,
            (operation) => operation()
        );
        expect(ipcMain.handle).toHaveBeenCalledWith(
            HOSTED_DEVICE_CONTROL,
            expect.any(Function)
        );
    });

    afterEach(() => {
        setHostedServerSession();
        jest.restoreAllMocks();
    });

    it('only creates tunnel invitations for an Access-protected route and uses the worker', async () => {
        status.publicRoute = 'unverified';
        await expect(invoke({ action: 'invite' })).rejects.toThrow(
            'Access route'
        );
        status.publicRoute = 'access-protected';
        worker.mockResolvedValueOnce({
            status: 201,
            body: { inviteId, expiresAt },
        });
        await expect(invoke({ action: 'invite' })).resolves.toEqual({
            url: `${origin}/connect-device.html#iptvnator-access=${instanceId}&invite=${inviteId}`,
            expiresAt,
        });
        expect(worker).toHaveBeenCalledWith({
            path: '/v1/device-pairing/invite',
            method: 'POST',
            body: { origin },
        });
        worker.mockResolvedValueOnce({
            status: 201,
            body: { inviteId: 'invalid', expiresAt },
        });
        await expect(invoke({ action: 'invite' })).rejects.toThrow(
            'Invalid hosted device invitation'
        );
    });

    it('preserves a requested invitation state and normalizes device approval', async () => {
        worker.mockResolvedValueOnce({
            status: 200,
            body: {
                inviteActive: false,
                pending: [
                    {
                        claimId,
                        inviteId,
                        name: 'Demo TV',
                        confirmationCode: '012345',
                    },
                ],
                devices: [
                    {
                        id: deviceId,
                        name: 'Demo phone',
                        canApprove: true,
                        internal: 'hidden',
                    },
                ],
            },
        });
        await expect(invoke({ action: 'list', inviteId })).resolves.toEqual({
            inviteActive: false,
            pending: [
                {
                    claimId,
                    inviteId,
                    name: 'Demo TV',
                    confirmationCode: '012345',
                },
            ],
            devices: [{ id: deviceId, name: 'Demo phone', canApprove: true }],
        });
        expect(worker).toHaveBeenCalledWith({
            path: `/v1/devices?invite=${inviteId}`,
            method: 'GET',
        });
        worker.mockResolvedValueOnce({ status: 503, body: undefined });
        await expect(
            invoke({ action: 'list', inviteId: 'invalid' })
        ).rejects.toThrow('Hosted device request failed');
        expect(worker).toHaveBeenLastCalledWith({
            path: '/v1/devices',
            method: 'GET',
        });
    });

    it('controls approval and revocation only with validated IDs and inputs', async () => {
        expect(() => invoke(null)).toThrow('Invalid hosted device request');
        await expect(invoke({ action: 'unknown' })).rejects.toThrow(
            'Invalid hosted device request'
        );
        await expect(
            invoke({ action: 'approve', claimId: 'invalid' })
        ).rejects.toThrow('Invalid hosted device claim');
        await expect(
            invoke({ action: 'revoke', deviceId: 'invalid' })
        ).rejects.toThrow('Invalid hosted device ID');
        await expect(
            invoke({ action: 'set-device-approval', deviceId, canApprove: 1 })
        ).rejects.toThrow('Invalid hosted device approval');
        expect(worker).not.toHaveBeenCalled();
        await expect(
            invoke({ action: 'approve', claimId })
        ).resolves.toBeUndefined();
        await expect(
            invoke({
                action: 'set-device-approval',
                deviceId,
                canApprove: false,
            })
        ).resolves.toBeUndefined();
        await expect(
            invoke({ action: 'revoke', deviceId })
        ).resolves.toBeUndefined();
        expect(worker.mock.calls.map(([request]) => request)).toEqual([
            {
                path: '/v1/device-pairing/approve',
                method: 'POST',
                body: { claimId },
            },
            {
                path: `/v1/devices/${deviceId}/approval`,
                method: 'PUT',
                body: { canApprove: false },
            },
            { path: `/v1/devices/${deviceId}`, method: 'DELETE' },
        ]);
    });

    it('checks browser pairing settings and permits clearing a password on native HTTPS', async () => {
        await expect(
            invoke({ action: 'set-browser-password', password: null })
        ).rejects.toThrow('HTTPS access is unavailable');
        status = {
            state: 'running',
            mode: 'https',
            endpoint: origin,
            httpsOrigin: origin,
        };
        await expect(
            invoke({ action: 'set-browser-password', password: 'short' })
        ).rejects.toThrow('Invalid hosted pairing password');
        await expect(
            invoke({ action: 'set-browser-password', password: null })
        ).resolves.toBeUndefined();
        expect(worker).toHaveBeenCalledWith({
            path: '/v1/device-pairing/browser-settings',
            method: 'POST',
            body: { password: null },
        });
        worker.mockResolvedValueOnce({
            status: 200,
            body: { passwordConfigured: 'yes' },
        });
        await expect(invoke({ action: 'browser-settings' })).rejects.toThrow(
            'Invalid hosted pairing settings'
        );
        worker.mockResolvedValueOnce({
            status: 200,
            body: { passwordConfigured: false },
        });
        await expect(invoke({ action: 'browser-settings' })).resolves.toEqual({
            passwordConfigured: false,
        });
    });
});
