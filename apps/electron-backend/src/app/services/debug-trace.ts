const TRACE_ENV_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const TRACE_PREFIX = '[IPTVnator Trace]';
const MAX_TRACE_ARRAY_ITEMS = 5;
const MAX_TRACE_OBJECT_KEYS = 8;
const MAX_TRACE_STRING_LENGTH = 180;
const MAX_TRACE_DEPTH = 2;

export const DEBUG_TRACE_EVENT_CHANNEL = 'IPTVNATOR_DEBUG_TRACE_EVENT';

function readFlag(name: string): boolean {
    const value = process.env[name]?.trim().toLowerCase();
    return value ? TRACE_ENV_TRUE_VALUES.has(value) : false;
}

function truncateString(value: string): string {
    if (value.length <= MAX_TRACE_STRING_LENGTH) {
        return value;
    }

    return `${value.slice(0, MAX_TRACE_STRING_LENGTH - 3)}...`;
}

function summarizeObject(
    value: Record<string, unknown>,
    depth: number
): Record<string, unknown> {
    const entries = Object.entries(value);
    const summary: Record<string, unknown> = {};

    if (value.constructor?.name && value.constructor.name !== 'Object') {
        summary.__type = value.constructor.name;
    }

    entries.slice(0, MAX_TRACE_OBJECT_KEYS).forEach(([key, entryValue]) => {
        summary[key] = summarizeForTrace(entryValue, depth + 1);
    });

    if (entries.length > MAX_TRACE_OBJECT_KEYS) {
        summary.__moreKeys = entries.length - MAX_TRACE_OBJECT_KEYS;
    }

    return summary;
}

export function isStartupTraceEnabled(): boolean {
    return readFlag('IPTVNATOR_TRACE_STARTUP');
}

export function isRendererApiTraceEnabled(): boolean {
    return isStartupTraceEnabled() || readFlag('IPTVNATOR_TRACE_IPC');
}

export function isDbTraceEnabled(): boolean {
    return isStartupTraceEnabled() || readFlag('IPTVNATOR_TRACE_DB');
}

export function isSqlTraceEnabled(): boolean {
    return (
        isStartupTraceEnabled() ||
        readFlag('IPTVNATOR_TRACE_DB') ||
        readFlag('IPTVNATOR_TRACE_SQL')
    );
}

export function isWindowTraceEnabled(): boolean {
    return isStartupTraceEnabled() || readFlag('IPTVNATOR_TRACE_WINDOW');
}

export function isRendererConsoleTraceEnabled(): boolean {
    return readFlag('IPTVNATOR_TRACE_RENDERER_CONSOLE');
}

export function isExternalPlayerTraceEnabled(): boolean {
    return isStartupTraceEnabled() || readFlag('IPTVNATOR_TRACE_PLAYER');
}

export function roundTraceDuration(durationMs: number): number {
    return Math.round(durationMs * 10) / 10;
}

export function compactSqlForTrace(sql: string): string {
    return truncateString(sql.replace(/\s+/g, ' ').trim());
}

export function summarizeForTrace(value: unknown, depth = 0): unknown {
    if (
        value == null ||
        typeof value === 'boolean' ||
        typeof value === 'number'
    ) {
        return value;
    }

    if (typeof value === 'string') {
        return truncateString(value);
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (typeof value === 'function') {
        return '[Function]';
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: truncateString(value.message),
        };
    }

    if (depth >= MAX_TRACE_DEPTH) {
        if (Array.isArray(value)) {
            return {
                type: 'array',
                length: value.length,
            };
        }

        return typeof value === 'object'
            ? {
                  type:
                      (value as { constructor?: { name?: string } }).constructor
                          ?.name ?? 'object',
              }
            : String(value);
    }

    if (Array.isArray(value)) {
        return {
            type: 'array',
            length: value.length,
            items: value
                .slice(0, MAX_TRACE_ARRAY_ITEMS)
                .map((entry) => summarizeForTrace(entry, depth + 1)),
        };
    }

    if (typeof value === 'object') {
        return summarizeObject(value as Record<string, unknown>, depth);
    }

    return String(value);
}

export function safeStringifyForTrace(payload: unknown): string {
    try {
        return JSON.stringify(payload);
    } catch (error) {
        return JSON.stringify({
            fallback: summarizeForTrace(payload),
            stringifyError:
                error instanceof Error
                    ? truncateString(error.message)
                    : String(error),
        });
    }
}

export function trace(scope: string, message: string, payload?: unknown): void {
    if (payload === undefined) {
        console.log(`${TRACE_PREFIX}[${scope}] ${message}`);
        return;
    }

    console.log(
        `${TRACE_PREFIX}[${scope}] ${message} ${safeStringifyForTrace(
            summarizeForTrace(payload)
        )}`
    );
}
