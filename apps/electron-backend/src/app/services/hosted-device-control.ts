import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
    HOSTED_DEVICE_CONTROL,
    type HostedDeviceList,
    type HostedServerStatus,
} from '@iptvnator/shared/interfaces';
import {
    getHostedServerAccessCode,
    HOSTED_SERVER_LOCAL_URL,
} from './hosted-server-session';

const pairingId = /^[A-Za-z0-9_-]{43}$/;
const deviceId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

async function request(path: string, code: string, options?: RequestInit) {
    const response = await fetch(`${HOSTED_SERVER_LOCAL_URL}/api/v1${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${code}`,
            'Content-Type': 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('Hosted device request failed');
    return response;
}

export function registerHostedDeviceEvents(
    checkSender: (event: IpcMainInvokeEvent) => void,
    status: () => HostedServerStatus,
    enqueue: <T>(operation: () => Promise<T>) => Promise<T>
): void {
    ipcMain.handle(HOSTED_DEVICE_CONTROL, (event, command: unknown) => {
        checkSender(event);
        if (!command || typeof command !== 'object' || !('action' in command))
            throw new Error('Invalid hosted device request');
        return enqueue(async () => {
            const current = status();
            const code = getHostedServerAccessCode();
            if (current.state !== 'running' || !code)
                throw new Error('Hosted server is unavailable');

            switch (command.action) {
                case 'invite': {
                    if (!current.lanUrl)
                        throw new Error('Home network sharing is unavailable');
                    const response = await request(
                        '/device-pairing/invite',
                        code,
                        {
                            method: 'POST',
                        }
                    );
                    const { inviteId, expiresAt } = await response.json();
                    if (
                        typeof inviteId !== 'string' ||
                        !pairingId.test(inviteId) ||
                        typeof expiresAt !== 'string' ||
                        !Number.isFinite(Date.parse(expiresAt))
                    )
                        throw new Error('Invalid hosted device invitation');
                    const url = new URL('/pair-device', current.lanUrl);
                    url.hash = inviteId;
                    return { url: url.href, expiresAt };
                }
                case 'list': {
                    const response = await request('/devices', code);
                    const { pending, devices }: HostedDeviceList =
                        await response.json();
                    return {
                        pending: pending.map(
                            ({
                                claimId,
                                inviteId,
                                name,
                                confirmationCode,
                            }) => ({
                                claimId,
                                inviteId,
                                name,
                                confirmationCode,
                            })
                        ),
                        devices: devices.map(({ id, name }) => ({ id, name })),
                    };
                }
                case 'approve': {
                    if (
                        !('claimId' in command) ||
                        typeof command.claimId !== 'string' ||
                        !pairingId.test(command.claimId)
                    )
                        throw new Error('Invalid hosted device claim');
                    await request('/device-pairing/approve', code, {
                        method: 'POST',
                        body: JSON.stringify({ claimId: command.claimId }),
                    });
                    return;
                }
                case 'revoke': {
                    if (
                        !('deviceId' in command) ||
                        typeof command.deviceId !== 'string' ||
                        !deviceId.test(command.deviceId)
                    )
                        throw new Error('Invalid hosted device ID');
                    await request(`/devices/${command.deviceId}`, code, {
                        method: 'DELETE',
                    });
                    return;
                }
                default:
                    throw new Error('Invalid hosted device request');
            }
        });
    });
}
