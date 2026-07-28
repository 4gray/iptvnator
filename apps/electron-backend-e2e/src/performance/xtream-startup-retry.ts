import {
    XTREAM_STARTUP_RETRY_REASON,
    type XtreamStartupRetryReason,
} from './xtream-summary-contract';

export interface XtreamStartupRetryOptions<Resource, Prepared> {
    readonly classifyFailure: (
        failure: unknown
    ) => XtreamStartupRetryReason | null;
    readonly create: (attempt: number) => Promise<Resource>;
    readonly dispose: (resource: Resource) => Promise<void>;
    readonly maxAttempts: number;
    readonly prepare: (
        resource: Resource,
        attempt: number
    ) => Promise<Prepared>;
}

export interface XtreamStartupRetryResult<Resource, Prepared> {
    readonly attemptCount: number;
    readonly prepared: Prepared;
    readonly resource: Resource;
    readonly retryReasons: readonly XtreamStartupRetryReason[];
}

function readFailureMessage(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure);
}

export function classifyXtreamStartupFailure(
    failure: unknown
): XtreamStartupRetryReason | null {
    const message = readFailureMessage(failure);
    if (/database is locked/i.test(message)) {
        return XTREAM_STARTUP_RETRY_REASON.SQLITE_DATABASE_LOCKED;
    }
    if (/no such table/i.test(message)) {
        return XTREAM_STARTUP_RETRY_REASON.SQLITE_SCHEMA_NOT_READY;
    }
    return null;
}

async function disposeFailedStartup<Resource>(
    dispose: (resource: Resource) => Promise<void>,
    failure: unknown,
    resource: Resource
): Promise<void> {
    try {
        await dispose(resource);
    } catch (disposeFailure) {
        throw new AggregateError(
            [failure, disposeFailure],
            'Xtream startup and failed-attempt disposal both failed',
            { cause: failure }
        );
    }
}

export async function runXtreamStartupWithRetry<Resource, Prepared>(
    options: XtreamStartupRetryOptions<Resource, Prepared>
): Promise<XtreamStartupRetryResult<Resource, Prepared>> {
    if (
        !Number.isInteger(options.maxAttempts) ||
        options.maxAttempts < 1 ||
        options.maxAttempts > 2
    ) {
        throw new Error('xtream-startup-attempt-limit-invalid');
    }

    const retryReasons: XtreamStartupRetryReason[] = [];
    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
        const resource = await options.create(attempt);
        try {
            const prepared = await options.prepare(resource, attempt);
            return Object.freeze({
                attemptCount: attempt,
                prepared,
                resource,
                retryReasons: Object.freeze([...retryReasons]),
            });
        } catch (failure) {
            const retryReason = options.classifyFailure(failure);
            await disposeFailedStartup(options.dispose, failure, resource);
            if (!retryReason || attempt === options.maxAttempts) {
                throw failure;
            }
            retryReasons.push(retryReason);
        }
    }

    throw new Error('xtream-startup-attempts-exhausted');
}
