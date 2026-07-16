import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'node:http';
import { join } from 'node:path';

const ALLOWED_FILE =
    /^(?:index\.m3u8|segment-\d+\.(?:ts|m4s|mp4)|init(?:-\d+)?\.mp4)$/;

export interface LocalTimeshiftHttpServer {
    playbackUrl: string;
    close(): Promise<void>;
}

export async function createLocalTimeshiftHttpServer(
    directory: string,
    token: string
): Promise<LocalTimeshiftHttpServer> {
    const server = createServer((request, response) => {
        void handleRequest(directory, token, request, response);
    });
    await listenOnLoopback(server);
    const address = server.address();
    if (!address || typeof address === 'string') {
        await closeHttpServer(server);
        throw new Error('Local timeshift server did not bind to TCP');
    }

    return {
        playbackUrl: `http://127.0.0.1:${address.port}/${token}/index.m3u8`,
        close: () => closeHttpServer(server),
    };
}

async function handleRequest(
    directory: string,
    token: string,
    request: IncomingMessage,
    response: ServerResponse
): Promise<void> {
    setSecurityHeaders(request, response);
    const fileName = resolveLocalTimeshiftFileName(request.url, token);
    if (!fileName) {
        sendStatus(response, 404);
        return;
    }
    if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD, OPTIONS');
        sendStatus(response, 405);
        return;
    }

    const filePath = join(directory, fileName);
    try {
        const fileStats = await stat(filePath);
        if (!fileStats.isFile()) {
            sendStatus(response, 404);
            return;
        }
        const range = parseRange(request.headers.range, fileStats.size);
        if (range === null) {
            response.setHeader('Content-Range', `bytes */${fileStats.size}`);
            sendStatus(response, 416);
            return;
        }
        const start = range?.start ?? 0;
        const end = range?.end ?? Math.max(0, fileStats.size - 1);
        response.statusCode = range ? 206 : 200;
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader('Content-Type', contentType(fileName));
        response.setHeader(
            'Content-Length',
            String(Math.max(0, end - start + 1))
        );
        if (range) {
            response.setHeader(
                'Content-Range',
                `bytes ${start}-${end}/${fileStats.size}`
            );
        }
        if (request.method === 'HEAD' || fileStats.size === 0) {
            response.end();
            return;
        }
        const stream = createReadStream(filePath, { start, end });
        stream.once('error', () => response.destroy());
        stream.pipe(response);
    } catch {
        if (!response.headersSent) {
            sendStatus(response, 404);
        } else {
            response.destroy();
        }
    }
}

export function resolveLocalTimeshiftFileName(
    rawUrl: string | undefined,
    expectedToken: string
): string | undefined {
    try {
        const url = new URL(rawUrl ?? '/', 'http://127.0.0.1');
        const parts = url.pathname.split('/');
        if (parts.length !== 3 || parts[0] !== '') return undefined;
        const token = decodeURIComponent(parts[1]);
        const fileName = decodeURIComponent(parts[2]);
        if (
            !tokensMatch(token, expectedToken) ||
            !ALLOWED_FILE.test(fileName)
        ) {
            return undefined;
        }
        return fileName;
    } catch {
        return undefined;
    }
}

function tokensMatch(actual: string, expected: string): boolean {
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    return (
        actualBytes.length === expectedBytes.length &&
        timingSafeEqual(actualBytes, expectedBytes)
    );
}

function setSecurityHeaders(
    request: IncomingMessage,
    response: ServerResponse
): void {
    for (const [name, value] of Object.entries(
        localTimeshiftResponseHeaders(request.headers.origin)
    )) {
        response.setHeader(name, value);
    }
}

export function localTimeshiftResponseHeaders(
    origin: string | undefined
): Record<string, string> {
    const headers: Record<string, string> = {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Origin',
    };
    if (origin === 'null' || isLoopbackOrigin(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Range';
    }
    return headers;
}

function isLoopbackOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    try {
        const url = new URL(origin);
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
        );
    } catch {
        return false;
    }
}

function parseRange(
    rawRange: string | undefined,
    size: number
): { start: number; end: number } | null | undefined {
    if (!rawRange) return undefined;
    const match = /^bytes=(\d*)-(\d*)$/.exec(rawRange);
    if (!match || size === 0) return null;
    let start: number;
    let end: number;
    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!suffixLength) return null;
        start = Math.max(0, size - suffixLength);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : size - 1;
    }
    if (start >= size || end < start) return null;
    return { start, end: Math.min(end, size - 1) };
}

function contentType(fileName: string): string {
    if (fileName.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (fileName.endsWith('.ts')) return 'video/mp2t';
    return 'video/mp4';
}

function sendStatus(response: ServerResponse, statusCode: number): void {
    response.statusCode = statusCode;
    response.end();
}

function listenOnLoopback(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        const handleError = (error: Error) => reject(error);
        server.once('error', handleError);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', handleError);
            resolve();
        });
    });
}

function closeHttpServer(server: Server): Promise<void> {
    return new Promise((resolve) => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close(() => resolve());
        server.closeAllConnections?.();
    });
}
