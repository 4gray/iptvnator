import type { UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import type { HostedServerWorkerMessage } from '@iptvnator/shared/interfaces';

/** Commands are serialized by the hosted-server lifecycle queue. */
export function configureHostedHttps(
    worker: UtilityProcess,
    origin: string
): Promise<Extract<HostedServerWorkerMessage, { https: true }>> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeout);
            worker.off('message', message);
            worker.off('exit', fail);
        };
        const fail = () => {
            cleanup();
            reject(new Error('HTTPS listener unavailable'));
        };
        const message = (value: HostedServerWorkerMessage) => {
            if (!('https' in value) || value.requestId !== requestId) return;
            cleanup();
            resolve(value);
        };
        const timeout = setTimeout(fail, 10000);
        worker.on('message', message);
        worker.once('exit', fail);
        try {
            worker.postMessage({ httpsOrigin: origin, requestId });
        } catch {
            fail();
        }
    });
}
