import type { ChildProcess } from 'node:child_process';

type ElectronChildProcess = Pick<
    ChildProcess,
    'exitCode' | 'kill' | 'once' | 'removeListener' | 'signalCode'
>;

export interface ClosableElectronApplication {
    close(): Promise<void>;
    process(): ElectronChildProcess;
}

export interface ElectronExitConfirmationOptions {
    readonly closeTimeoutMs: number;
    readonly exitTimeoutMs: number;
}

export interface PrepareElectronApplicationOptions<Application, Prepared> {
    readonly application: Application;
    readonly dispose: (application: Application) => Promise<void>;
    readonly prepare: (application: Application) => Promise<Prepared>;
}

export class ElectronApplicationDisposalError extends AggregateError {
    constructor(failure: unknown, disposeFailure: unknown) {
        super(
            [failure, disposeFailure],
            'Electron launch preparation and disposal both failed',
            { cause: failure }
        );
        this.name = 'ElectronApplicationDisposalError';
    }
}

export async function prepareElectronApplication<Application, Prepared>(
    options: PrepareElectronApplicationOptions<Application, Prepared>
): Promise<Prepared> {
    try {
        return await options.prepare(options.application);
    } catch (failure) {
        try {
            await options.dispose(options.application);
        } catch (disposeFailure) {
            throw new ElectronApplicationDisposalError(failure, disposeFailure);
        }
        throw failure;
    }
}

export async function closeElectronApplicationAndConfirmExit(
    application: ClosableElectronApplication,
    options: ElectronExitConfirmationOptions
): Promise<void> {
    assertTimeout(options.closeTimeoutMs);
    assertTimeout(options.exitTimeoutMs);
    const child = application.process();
    if (hasExited(child)) return;

    const exit = observeProcessExit(child);
    let failure: unknown;
    try {
        const close = Promise.resolve()
            .then(() => application.close())
            .then(
                () => ({ kind: 'close-resolved' as const }),
                (closeFailure: unknown) => ({
                    failure: closeFailure,
                    kind: 'close-rejected' as const,
                })
            );
        const first = await raceCloseAndExit(
            close,
            exit.promise,
            options.closeTimeoutMs
        );
        if (first.kind === 'exit') return;
        if (
            first.kind === 'close-resolved' &&
            (await resolvesWithin(exit.promise, options.exitTimeoutMs))
        ) {
            return;
        }
        if (first.kind === 'close-rejected') failure = first.failure;

        try {
            child.kill();
        } catch (killFailure) {
            failure = failure
                ? new AggregateError([failure, killFailure])
                : killFailure;
        }
        if (await resolvesWithin(exit.promise, options.exitTimeoutMs)) return;
    } finally {
        exit.cancel();
    }
    throw new Error('electron-process-exit-unconfirmed', { cause: failure });
}

function hasExited(child: ElectronChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

function observeProcessExit(child: ElectronChildProcess): {
    readonly cancel: () => void;
    readonly promise: Promise<void>;
} {
    let resolveExit: (() => void) | undefined;
    const onExit = () => resolveExit?.();
    const promise = new Promise<void>((resolvePromise) => {
        resolveExit = resolvePromise;
        child.once('exit', onExit);
        if (hasExited(child)) resolvePromise();
    });
    return {
        cancel: () => child.removeListener('exit', onExit),
        promise,
    };
}

async function resolvesWithin(
    promise: Promise<unknown>,
    timeoutMs: number
): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise.then(() => true),
            new Promise<boolean>((resolvePromise) => {
                timeout = setTimeout(() => resolvePromise(false), timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

async function raceCloseAndExit(
    close: Promise<
        | { readonly kind: 'close-resolved' }
        | { readonly failure: unknown; readonly kind: 'close-rejected' }
    >,
    exit: Promise<void>,
    timeoutMs: number
): Promise<
    | { readonly kind: 'close-resolved' }
    | { readonly failure: unknown; readonly kind: 'close-rejected' }
    | { readonly kind: 'exit' }
    | { readonly kind: 'timeout' }
> {
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            close,
            exit.then(() => ({ kind: 'exit' as const })),
            new Promise<{ readonly kind: 'timeout' }>((resolvePromise) => {
                timeout = setTimeout(
                    () => resolvePromise({ kind: 'timeout' }),
                    timeoutMs
                );
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function assertTimeout(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error('electron-process-exit-timeout-invalid');
    }
}
