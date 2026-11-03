import { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

export const DEFAULT_PROVIDER_RESPONSE_BYTES = 64 * 1024 * 1024;

export class ProviderResponseTooLargeError extends Error {
    readonly code = 'PROVIDER_RESPONSE_TOO_LARGE';
    constructor() {
        super('Provider response exceeds the configured size limit');
    }
}

export function providerResponseLimitBytes(): number {
    const bytes =
        Number(process.env['IPTVNATOR_MAX_PROVIDER_RESPONSE_MB']) * 1024 * 1024;
    return Number.isSafeInteger(bytes) && bytes > 0
        ? bytes
        : DEFAULT_PROVIDER_RESPONSE_BYTES;
}

export function decodeProviderGzip(data: Uint8Array, maxBytes: number): string {
    try {
        return gunzipSync(data, { maxOutputLength: maxBytes }).toString();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE')
            throw new ProviderResponseTooLargeError();
        throw error;
    }
}

/** Redirect bodies are irrelevant, including invalid gzip and endless bodies. */
export function discardProviderBody(data: unknown): void {
    if (data instanceof Readable) data.destroy();
}

export function discardProviderErrorBody(error: unknown): void {
    const response = (error as { response?: { data?: unknown } } | null)
        ?.response;
    discardProviderBody(response?.data);
}

/** Match axios's buffered default and arraybuffer modes for the final hop. */
export async function readProviderBody<T>(
    data: T,
    arraybuffer: boolean,
    timeout?: number,
    socket?: Socket,
    maxBytes = DEFAULT_PROVIDER_RESPONSE_BYTES
): Promise<T> {
    if (!(data instanceof Readable)) return data;
    const chunks: Buffer[] = [];
    let bytes = 0;
    // Axios resolves stream responses at headers and then ignores its own
    // request timeout callback. Keep the native socket's inactivity timer
    // alive until the body finishes; arriving wire bytes reset it, even if
    // decompression has not emitted another decoded chunk yet.
    const onTimeout = () =>
        data.destroy(
            Object.assign(new Error('Provider response body timed out'), {
                code: 'ECONNABORTED',
            })
        );
    if (timeout && socket) socket.setTimeout(timeout, onTimeout);
    try {
        for await (const chunk of data) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > maxBytes) {
                data.destroy();
                throw new ProviderResponseTooLargeError();
            }
            chunks.push(buffer);
        }
    } finally {
        if (timeout && socket) {
            socket.removeListener('timeout', onTimeout);
            socket.setTimeout(0);
        }
    }
    const buffer = Buffer.concat(chunks);
    if (arraybuffer) return buffer as T;
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    try {
        return JSON.parse(text) as T;
    } catch {
        return text as T;
    }
}
