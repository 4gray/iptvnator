import { createBackgroundInterval } from './background-interval';

class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    readonly posted: unknown[] = [];
    terminated = false;

    constructor(readonly url: string) {
        FakeWorker.instances.push(this);
    }

    postMessage(message: unknown): void {
        this.posted.push(message);
    }

    terminate(): void {
        this.terminated = true;
    }

    tick(): void {
        this.onmessage?.({ data: 0 } as MessageEvent);
    }
}

describe('createBackgroundInterval', () => {
    const scope = globalThis as unknown as {
        Worker?: unknown;
        URL: typeof URL & {
            createObjectURL?: (blob: Blob) => string;
            revokeObjectURL?: (url: string) => void;
        };
    };
    const originalWorker = scope.Worker;
    const originalCreate = scope.URL.createObjectURL;
    const originalRevoke = scope.URL.revokeObjectURL;

    beforeEach(() => {
        jest.useFakeTimers();
        FakeWorker.instances = [];
        scope.URL.createObjectURL = jest.fn(() => 'blob:ticker');
        scope.URL.revokeObjectURL = jest.fn();
    });

    afterEach(() => {
        jest.useRealTimers();
        scope.Worker = originalWorker;
        scope.URL.createObjectURL = originalCreate;
        scope.URL.revokeObjectURL = originalRevoke;
    });

    it('falls back to a page interval where Worker is unavailable', () => {
        delete scope.Worker;
        const callback = jest.fn();

        const stop = createBackgroundInterval(callback, 30_000);
        jest.advanceTimersByTime(60_000);
        expect(callback).toHaveBeenCalledTimes(2);

        stop();
        jest.advanceTimersByTime(60_000);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('ticks from a worker and schedules no page timer', () => {
        scope.Worker = FakeWorker;
        const callback = jest.fn();

        const stop = createBackgroundInterval(callback, 30_000);
        const [worker] = FakeWorker.instances;

        expect(worker.url).toBe('blob:ticker');
        expect(worker.posted).toEqual([30_000]);
        expect(jest.getTimerCount()).toBe(0);
        worker.tick();
        worker.tick();
        expect(callback).toHaveBeenCalledTimes(2);

        stop();
        expect(worker.terminated).toBe(true);
        expect(scope.URL.revokeObjectURL).toHaveBeenCalledWith('blob:ticker');
    });

    it('falls back to a page interval when the worker fails to start', () => {
        scope.Worker = FakeWorker;
        const callback = jest.fn();

        const stop = createBackgroundInterval(callback, 30_000);
        const [worker] = FakeWorker.instances;
        worker.onerror?.(new Event('error'));

        expect(worker.terminated).toBe(true);
        jest.advanceTimersByTime(30_000);
        expect(callback).toHaveBeenCalledTimes(1);

        stop();
        jest.advanceTimersByTime(60_000);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('stays stopped when a worker error arrives after stop', () => {
        scope.Worker = FakeWorker;
        const callback = jest.fn();

        const stop = createBackgroundInterval(callback, 30_000);
        const [worker] = FakeWorker.instances;
        const lateError = worker.onerror;
        stop();
        lateError?.(new Event('error'));

        jest.advanceTimersByTime(90_000);
        expect(callback).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });
});
