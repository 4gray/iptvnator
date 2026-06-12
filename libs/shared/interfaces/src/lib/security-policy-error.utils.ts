export const SECURITY_ERROR_PREFIX = 'IPTVNATOR_SECURITY_ERROR:';

export interface SerializedSecurityError {
    readonly code: string;
    readonly host?: string;
    readonly message: string;
}

function readErrorMessage(error: unknown): string | undefined {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === 'string') {
        return error;
    }

    if (error && typeof error === 'object') {
        const message = (error as { readonly message?: unknown }).message;
        if (typeof message === 'string') {
            return message;
        }
    }

    return undefined;
}

function parseSecurityPayload(payload: string): SerializedSecurityError | null {
    try {
        const parsed = JSON.parse(payload);
        if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.code === 'string' &&
            typeof parsed.message === 'string'
        ) {
            return {
                code: parsed.code,
                host: typeof parsed.host === 'string' ? parsed.host : undefined,
                message: parsed.message,
            };
        }
    } catch {
        return null;
    }

    return null;
}

export function parseSecurityPolicyError(
    error: unknown
): SerializedSecurityError | null {
    const message = readErrorMessage(error);
    const prefixIndex = message?.indexOf(SECURITY_ERROR_PREFIX) ?? -1;
    if (!message || prefixIndex < 0) {
        return null;
    }

    const payload = message.slice(prefixIndex + SECURITY_ERROR_PREFIX.length);
    const parsed = parseSecurityPayload(payload);
    if (parsed) {
        return parsed;
    }

    const payloadEnd = payload.lastIndexOf('}');
    return payloadEnd >= 0
        ? parseSecurityPayload(payload.slice(0, payloadEnd + 1))
        : null;
}

export function normalizeHost(host: string): string {
    return host
        .trim()
        .toLowerCase()
        .replace(/^\[(.*)\]$/, '$1');
}
