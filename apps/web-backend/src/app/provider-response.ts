import { Socket } from 'node:net';
import { Readable } from 'node:stream';

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
    socket?: Socket
): Promise<T> {
    if (!(data instanceof Readable)) return data;
    const chunks: Buffer[] = [];
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
        for await (const chunk of data) chunks.push(Buffer.from(chunk));
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
