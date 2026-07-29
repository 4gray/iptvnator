import type { Page } from '@playwright/test';

export const RENDERER_HEARTBEAT_INTERVAL_MS = 50;

interface RendererHeartbeatState {
    readonly heartbeatDelaysMs: number[];
    readonly operationStartEpochMs: number;
    readonly terminalEpochMs: number | null;
}

export async function recordFixedGridRendererHeartbeats(
    page: Page,
    stateKey: string,
    firstDeadlineEpochMs: number,
    unavailableError: string
): Promise<number> {
    return page.evaluate(
        ({
            firstDeadlineEpochMs,
            intervalMs,
            stateKey,
            unavailableError,
        }) => {
            const state = (globalThis as unknown as Record<string, unknown>)[
                stateKey
            ] as RendererHeartbeatState | undefined;
            if (
                !state ||
                !Number.isFinite(firstDeadlineEpochMs) ||
                state.operationStartEpochMs <= 0 ||
                firstDeadlineEpochMs < state.operationStartEpochMs
            ) {
                throw new Error(unavailableError);
            }
            const receivedEpochMs =
                performance.timeOrigin + performance.now();
            const effectiveReceivedEpochMs = Math.max(
                receivedEpochMs,
                firstDeadlineEpochMs
            );
            const captureEpochMs =
                state.terminalEpochMs === null
                    ? effectiveReceivedEpochMs
                    : Math.min(
                          effectiveReceivedEpochMs,
                          state.terminalEpochMs
                      );
            if (captureEpochMs < firstDeadlineEpochMs) {
                return firstDeadlineEpochMs;
            }
            const elapsedDeadlineCount =
                Math.floor(
                    (captureEpochMs - firstDeadlineEpochMs) / intervalMs
                ) + 1;
            for (let index = 0; index < elapsedDeadlineCount; index += 1) {
                const deadlineEpochMs =
                    firstDeadlineEpochMs + index * intervalMs;
                state.heartbeatDelaysMs.push(
                    Math.max(0, captureEpochMs - deadlineEpochMs)
                );
            }
            return (
                firstDeadlineEpochMs +
                elapsedDeadlineCount * intervalMs
            );
        },
        {
            firstDeadlineEpochMs,
            intervalMs: RENDERER_HEARTBEAT_INTERVAL_MS,
            stateKey,
            unavailableError,
        }
    );
}

export function assertFixedGridRendererHeartbeatCoverage(
    heartbeatDelaysMs: readonly number[],
    operationStartEpochMs: number,
    terminalEpochMs: number
): void {
    if (
        !Number.isFinite(operationStartEpochMs) ||
        !Number.isFinite(terminalEpochMs) ||
        terminalEpochMs < operationStartEpochMs
    ) {
        throw new Error('renderer-heartbeat-grid-window-invalid');
    }
    const expectedCount = Math.floor(
        (terminalEpochMs - operationStartEpochMs) /
            RENDERER_HEARTBEAT_INTERVAL_MS
    );
    if (heartbeatDelaysMs.length !== expectedCount) {
        throw new Error(
            `renderer-heartbeat-grid-incomplete:${heartbeatDelaysMs.length}/${expectedCount}`
        );
    }
}
