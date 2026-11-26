import { randomUUID } from 'node:crypto';
import type { UtilityProcess } from 'electron';
import type {
    HostedServerWorkerMessage,
    HostedWorkerRequest,
    HostedWorkerResponse,
} from '@iptvnator/shared/interfaces';

export function createHostedWorkerClient(worker: UtilityProcess) {
    return (
        workerRequest: HostedWorkerRequest
    ): Promise<HostedWorkerResponse> =>
        new Promise((resolve, reject) => {
            const requestId = randomUUID();
            const onExit = () => finish();
            const onMessage = (message: HostedServerWorkerMessage) => {
                if ('reply' in message && message.reply === requestId)
                    finish(message.response);
            };
            const deadline = setTimeout(onExit, 125_000);
            const finish = (response?: HostedWorkerResponse) => {
                clearTimeout(deadline);
                worker.off('message', onMessage);
                worker.off('exit', onExit);
                if (response) resolve(response);
                else reject(new Error('Hosted worker request failed'));
            };
            worker.on('message', onMessage);
            worker.once('exit', onExit);
            try {
                worker.postMessage({ requestId, workerRequest });
            } catch {
                finish();
            }
        });
}
