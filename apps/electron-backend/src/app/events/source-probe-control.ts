import { ipcMain } from 'electron';
import {
    SOURCE_HEALTH_CANCEL,
    SourceProbeContext,
} from '@iptvnator/shared/interfaces';

const requests = new Map<string, AbortController>();
export function sourceProbeControl(
    owner: number,
    context?: SourceProbeContext
) {
    if (!context) return { signal: undefined, dispose: () => undefined };
    const controller = new AbortController();
    const key = `${owner}:${context.requestId}`;
    const remaining = Math.min(
        15000,
        Math.max(0, context.deadlineAt - Date.now())
    );
    requests.set(key, controller);
    const timer = setTimeout(() => controller.abort(), remaining);
    if (!remaining) controller.abort();
    return {
        signal: controller.signal,
        dispose: () => {
            clearTimeout(timer);
            if (requests.get(key) === controller) requests.delete(key);
        },
    };
}
export function registerSourceProbeCancellation() {
    ipcMain.handle(SOURCE_HEALTH_CANCEL, (event, requestId: string) => {
        requests.get(`${event.sender.id}:${requestId}`)?.abort();
    });
}
