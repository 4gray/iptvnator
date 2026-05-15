import {
    PortalDebugEvent,
    PortalDebugProvider,
    PortalDebugTransport,
} from '@iptvnator/shared/interfaces';

export interface Logger {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}

function isProductionBuild(): boolean {
    const globalWithNgDevMode = globalThis as typeof globalThis & {
        ngDevMode?: boolean;
    };

    return globalWithNgDevMode.ngDevMode === false;
}

export function createLogger(scope: string): Logger {
    const prefix = `[${scope}]`;
    const debugEnabled = !isProductionBuild();

    return {
        debug: (...args: unknown[]) => {
            if (debugEnabled) {
                console.debug(prefix, ...args);
            }
        },
        info: (...args: unknown[]) => {
            if (debugEnabled) {
                console.info(prefix, ...args);
            }
        },
        warn: (...args: unknown[]) => {
            console.warn(prefix, ...args);
        },
        error: (...args: unknown[]) => {
            console.error(prefix, ...args);
        },
    };
}

export interface PortalDebugRequestContext {
    requestId: string;
    provider: PortalDebugProvider;
    operation: string;
    transport: PortalDebugTransport;
    request: unknown;
    startedAt: number;
    startedAtIso: string;
}

let portalRequestSequence = 0;

function isPortalDebugEnabled(): boolean {
    return !isProductionBuild();
}

function getNow(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createPortalRequestId(provider: PortalDebugProvider): string {
    portalRequestSequence += 1;
    return `${provider}-${Date.now().toString(36)}-${portalRequestSequence}`;
}

function formatDuration(durationMs: number): string {
    return `${durationMs.toFixed(1)}ms`;
}

function logPortalDebugSection(
    label: string,
    value: unknown,
    method: 'log' | 'error' = 'log'
): void {
    if (typeof console[method] === 'function') {
        console[method](label, value);
    }
}

export function createPortalDebugRequestContext(input: {
    provider: PortalDebugProvider;
    operation: string;
    transport: PortalDebugTransport;
    request: unknown;
}): PortalDebugRequestContext {
    return {
        requestId: createPortalRequestId(input.provider),
        provider: input.provider,
        operation: input.operation,
        transport: input.transport,
        request: input.request,
        startedAt: getNow(),
        startedAtIso: new Date().toISOString(),
    };
}

export function createPortalDebugSuccessEvent(
    context: PortalDebugRequestContext,
    response: unknown
): PortalDebugEvent {
    return {
        requestId: context.requestId,
        provider: context.provider,
        operation: context.operation,
        transport: context.transport,
        request: context.request,
        response,
        startedAt: context.startedAtIso,
        durationMs: getNow() - context.startedAt,
        status: 'success',
    };
}

export function createPortalDebugErrorEvent(
    context: PortalDebugRequestContext,
    error: unknown
): PortalDebugEvent {
    return {
        requestId: context.requestId,
        provider: context.provider,
        operation: context.operation,
        transport: context.transport,
        request: context.request,
        error,
        startedAt: context.startedAtIso,
        durationMs: getNow() - context.startedAt,
        status: 'error',
    };
}

export function logPortalDebugRequest(
    context: PortalDebugRequestContext
): void {
    if (!isPortalDebugEnabled()) {
        return;
    }

    console.groupCollapsed(
        `[PortalDebug:${context.provider}] ${context.operation} request ${context.requestId}`
    );
    logPortalDebugSection('meta', {
        requestId: context.requestId,
        provider: context.provider,
        operation: context.operation,
        transport: context.transport,
        startedAt: context.startedAtIso,
    });
    logPortalDebugSection('request', context.request);
    console.groupEnd();
}

export function logPortalDebugEvent(event: PortalDebugEvent): void {
    if (!isPortalDebugEnabled()) {
        return;
    }

    const statusLabel = event.status === 'success' ? 'response' : 'error';
    console.groupCollapsed(
        `[PortalDebug:${event.provider}] ${event.operation} ${statusLabel} ${event.requestId} ${formatDuration(event.durationMs)}`
    );
    logPortalDebugSection('meta', {
        requestId: event.requestId,
        provider: event.provider,
        operation: event.operation,
        transport: event.transport,
        startedAt: event.startedAt,
        durationMs: event.durationMs,
        status: event.status,
    });
    logPortalDebugSection('request', event.request);

    if (event.status === 'success') {
        logPortalDebugSection('response', event.response);
    } else {
        logPortalDebugSection('error', event.error, 'error');
    }

    console.groupEnd();
}
