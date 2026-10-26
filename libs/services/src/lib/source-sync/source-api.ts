import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import { sourceAuthorization, sourceConnection } from './source-connection';

export function sourceRequestRoute(request: SourceServerRequest): {
    path: string;
    method: string;
} {
    const id = encodeURIComponent(request.id ?? '');
    switch (request.operation) {
        case 'instance':
            return { path: '/v1/instance', method: 'GET' };
        case 'list':
            return { path: '/v1/sources', method: 'GET' };
        case 'get':
            return { path: `/v1/sources/${id}`, method: 'GET' };
        case 'create':
            return { path: `/v1/sources/${id}`, method: 'PUT' };
        case 'update':
            return { path: `/v1/sources/${id}`, method: 'PATCH' };
        case 'delete':
            return { path: `/v1/sources/${id}`, method: 'DELETE' };
        case 'clear':
            return { path: '/v1/sources', method: 'DELETE' };
    }
}

export async function requestSourceServer(
    request: SourceServerRequest
): Promise<SourceServerResponse> {
    if (window.electron?.sourceSyncRequest)
        return window.electron.sourceSyncRequest(request);
    const connection = sourceConnection();
    if (!connection) throw new Error('SOURCE_SYNC.OFFLINE');
    const route = sourceRequestRoute(request);
    const url = `${connection.apiUrl}${route.path}`;
    const response = await fetch(url, {
        method: route.method,
        redirect: 'error',
        signal: AbortSignal.timeout(
            ['get', 'create', 'update'].includes(request.operation)
                ? 120000
                : 15000
        ),
        headers: {
            ...sourceAuthorization(url),
            'Content-Type': 'application/json',
            'X-IPTVnator-Instance-Id': connection.instanceId,
            ...(request.operation === 'create' ? { 'If-None-Match': '*' } : {}),
            ...(request.revision
                ? {
                      [request.operation === 'list'
                          ? 'If-None-Match'
                          : 'If-Match']: request.revision,
                  }
                : {}),
        },
        ...(request.source ? { body: JSON.stringify(request.source) } : {}),
    });
    return {
        status: response.status,
        etag: response.headers.get('etag') ?? undefined,
        ...(response.status === 304 ? {} : { body: await response.json() }),
    };
}
