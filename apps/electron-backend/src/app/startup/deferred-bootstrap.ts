/**
 * Runs a deferred piece of main-process startup exactly once, triggered by
 * the main window's `did-start-loading` event or, as a fallback, explicitly.
 *
 * Ordering guarantee relied on by main.ts: `load()` is a webpack dynamic
 * import of a sibling chunk, which on the Electron main target is a
 * synchronous `require` wrapped in an already-resolved promise, and `run()`
 * registers IPC handlers synchronously. Both therefore finish within the
 * microtask checkpoint of the task that fired the trigger. A renderer IPC
 * message is delivered as a separate macrotask, so no `invoke` can arrive
 * between the renderer starting to load and the handlers existing.
 */
export interface DeferredBootstrapOptions<TModule, TResult> {
    readonly load: () => Promise<TModule>;
    readonly run: (module: TModule) => TResult;
    readonly onTrigger?: (source: DeferredBootstrapTrigger) => void;
    readonly onDone?: (durationMs: number) => void;
    /**
     * Called once when the load or the registration fails. The event
     * listener has no caller to report to, so without this a failure would
     * only surface as an unhandled rejection; the promise returned by
     * `trigger()` still rejects for callers that await it.
     */
    readonly onError?: (error: unknown) => void;
}

export type DeferredBootstrapTrigger = 'did-start-loading' | 'explicit';

export interface DeferredBootstrapOutcome<TModule, TResult> {
    readonly module: TModule;
    readonly result: TResult;
}

export interface DeferredBootstrapWebContents {
    once(event: 'did-start-loading', listener: () => void): unknown;
}

export interface DeferredBootstrap<TModule, TResult> {
    /** The loaded module, or null until the trigger has fired. */
    readonly module: TModule | null;
    /** Arms the `did-start-loading` trigger; a missing webContents is a no-op. */
    armOn(webContents: DeferredBootstrapWebContents | null | undefined): void;
    /** Starts load + run if not started yet; always returns the same promise. */
    trigger(
        source?: DeferredBootstrapTrigger
    ): Promise<DeferredBootstrapOutcome<TModule, TResult>>;
}

export function createDeferredBootstrap<TModule, TResult>(
    options: DeferredBootstrapOptions<TModule, TResult>
): DeferredBootstrap<TModule, TResult> {
    let started: Promise<DeferredBootstrapOutcome<TModule, TResult>> | null =
        null;
    let loadedModule: TModule | null = null;

    const trigger = (
        source: DeferredBootstrapTrigger = 'explicit'
    ): Promise<DeferredBootstrapOutcome<TModule, TResult>> => {
        if (started) {
            return started;
        }

        options.onTrigger?.(source);
        const startedAt = performance.now();
        started = options.load().then((module) => {
            loadedModule = module;
            const result = options.run(module);
            options.onDone?.(performance.now() - startedAt);
            return { module, result };
        });
        started.catch((error: unknown) => options.onError?.(error));
        return started;
    };

    return {
        get module() {
            return loadedModule;
        },
        armOn(webContents) {
            webContents?.once('did-start-loading', () => {
                // Rejections are reported through onError and re-surface to
                // whoever awaits trigger(); nothing to handle here.
                trigger('did-start-loading').catch(() => undefined);
            });
        },
        trigger,
    };
}
