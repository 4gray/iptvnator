import type { ErrorRequestHandler } from 'express';
import type { ServerStorageErrorBody } from '@iptvnator/shared/interfaces';
import {
    InvalidPlaylistDocumentError,
    PlaylistPayloadMissingError,
} from './server-playlist-repository';

export class StorageRequestError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string
    ) {
        super(message);
        this.name = 'StorageRequestError';
    }
}

export function toStorageErrorBody(error: unknown): ServerStorageErrorBody {
    if (error instanceof StorageRequestError) {
        return {
            message: error.message,
            status: error.status,
            code: error.code,
        };
    }
    if (error instanceof PlaylistPayloadMissingError) {
        return {
            message: 'The server has no stored payload for this playlist.',
            status: 409,
            code: 'payload_missing',
        };
    }
    if (error instanceof InvalidPlaylistDocumentError) {
        return {
            message: 'A playlist needs an id.',
            status: 400,
            code: 'invalid_body',
        };
    }
    const type = (error as { type?: unknown } | null)?.type;
    if (type === 'entity.too.large') {
        return {
            message: 'The request is larger than the server allows.',
            status: 413,
            code: 'too_large',
        };
    }
    if (type === 'entity.parse.failed') {
        return {
            message: 'The request body is not valid JSON.',
            status: 400,
            code: 'invalid_json',
        };
    }
    if ((error as { code?: unknown } | null)?.code === 'SQLITE_BUSY') {
        return {
            message: 'Storage is busy, try again.',
            status: 503,
            code: 'storage_busy',
        };
    }
    return {
        message: 'Storage request failed.',
        status: 500,
        code: 'storage_error',
    };
}

/**
 * Error name and code only: Drizzle and SQLite messages can carry bound
 * values such as portal credentials, which must never reach a log.
 */
export function describeStorageError(error: unknown): string {
    const name = error instanceof Error ? error.name : typeof error;
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? `${name} (${code})` : name;
}

export function storageErrorHandler(
    log: (message: string) => void = console.error
): ErrorRequestHandler {
    // Express recognizes error middleware by its four parameters.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return (error, req, res, _next) => {
        const body = toStorageErrorBody(error);
        if (body.status >= 500) {
            const route = `${req.baseUrl}${req.route?.path ?? ''}`;
            log(
                `[web-backend] storage ${req.method} ${route} failed: ${describeStorageError(error)}`
            );
        }
        res.status(body.status).json(body);
    };
}
