import {
    sourceAuthorization,
    assertSourceRequestAllowed,
    rejectSourceInstance,
    sourceVerificationRefusal,
} from './source-authorization';
import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    sourceConnection,
    invalidateSourceVerification,
} from './source-connection';

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
        case 'history-read':
            return { path: `/v1/history/sources/${id}`, method: 'GET' };
        case 'history-apply':
            return { path: '/v1/history/operations', method: 'POST' };
        case 'favorites-context':
            return { path: `/v1/favorites/sources/${id}`, method: 'GET' };
        case 'favorites-list':
            return {
                path: `/v1/favorites/sources/${id}/items${request.cursor ? '?cursor=' + encodeURIComponent(request.cursor) : ''}`,
                method: 'GET',
            };
        case 'favorites-read':
            return { path: '/v1/favorites/read', method: 'POST' };
        case 'favorites-apply':
            return { path: '/v1/favorites/operations', method: 'POST' };
        case 'activity-context':
            return { path: `/v1/activity/sources/${id}`, method: 'GET' };
        case 'activity-list':
            return {
                path: `/v1/activity/sources/${id}/items${request.cursor ? '?cursor=' + encodeURIComponent(request.cursor) : ''}`,
                method: 'GET',
            };
        case 'activity-read':
            return { path: '/v1/activity/read', method: 'POST' };
        case 'activity-apply':
            return { path: '/v1/activity/operations', method: 'POST' };
    }
}

export async function requestSourceServer(
    request: SourceServerRequest
): Promise<SourceServerResponse> {
    const refusal = sourceVerificationRefusal();
    if (request.operation !== 'instance' && refusal)
        return {
            status: refusal,
            body: {
                code: refusal === 409 ? 'instance_changed' : 'access_required',
            },
        };
    const connection = sourceConnection();
    if (window.electron?.sourceSyncRequest) {
        try {
            const response = await window.electron.sourceSyncRequest(request);
            if (
                response.status === 401 ||
                response.status === 403 ||
                (response.status === 409 &&
                    (response.body as { code?: string })?.code ===
                        'instance_changed') ||
                (request.operation === 'instance' &&
                    response.status >= 400 &&
                    response.status < 500)
            )
                rejectSourceInstance(
                    response.status === 401 || response.status === 403
                        ? response.status
                        : 409,
                    connection
                );
            return response;
        } catch (error) {
            const code =
                error instanceof Error
                    ? error.message.match(/SOURCE_SYNC\.[A-Z_]+/)?.[0]
                    : undefined;
            const status =
                code === 'SOURCE_SYNC.LOCKED'
                    ? 401
                    : code === 'SOURCE_SYNC.INSTANCE_CHANGED' ||
                        code === 'SOURCE_SYNC.INCOMPATIBLE'
                      ? 409
                      : undefined;
            if (!status) throw error;
            rejectSourceInstance(status, connection);
            if (request.operation === 'instance') throw error;
            return {
                status,
                body: {
                    code:
                        status === 409 ? 'instance_changed' : 'access_required',
                },
            };
        }
    }
    if (!connection) throw new Error('SOURCE_SYNC.OFFLINE');
    const route = sourceRequestRoute(request);
    const url = `${connection.apiUrl}${route.path}`;
    if (request.operation !== 'instance') assertSourceRequestAllowed(url);
    try {
        const response = await fetch(url, {
            method: route.method,
            redirect: 'error',
            signal: AbortSignal.timeout(
                ['get', 'create', 'update'].includes(request.operation)
                    ? 120000
                    : 15000
            ),
            headers: {
                ...(request.operation === 'instance'
                    ? {}
                    : sourceAuthorization(url)),
                'Content-Type': 'application/json',
                'X-IPTVnator-Instance-Id': connection.instanceId,
                ...(request.operation === 'create'
                    ? { 'If-None-Match': '*' }
                    : {}),
                ...(request.revision
                    ? {
                          [request.operation === 'list'
                              ? 'If-None-Match'
                              : 'If-Match']: request.revision,
                      }
                    : {}),
            },
            ...((request.history ??
            request.favorite ??
            request.activity ??
            request.source)
                ? {
                      body: JSON.stringify(
                          request.history ??
                              request.favorite ??
                              request.activity ??
                              request.source
                      ),
                  }
                : {}),
        });
        // These routes are server-owned; JSON 5xx responses are outages too.
        if (response.status >= 500) throw new Error('SOURCE_SYNC.OFFLINE');
        if (response.status === 401 || response.status === 403)
            rejectSourceInstance(response.status, connection);
        else if (request.operation === 'instance' && response.status >= 400)
            rejectSourceInstance(409, connection);
        const body =
            response.status === 304 ||
            (request.operation === 'instance' && response.status === 404)
                ? undefined
                : await response.json().catch((error) => {
                      if (
                          request.operation === 'instance' &&
                          response.status < 400
                      )
                          rejectSourceInstance(409, connection);
                      throw error;
                  });
        if (
            request.operation !== 'instance' &&
            response.status === 409 &&
            body?.code === 'instance_changed'
        )
            rejectSourceInstance(409, connection);
        return {
            status: response.status,
            etag: response.headers.get('etag') ?? undefined,
            ...(response.status === 304 ? {} : { body }),
        };
    } catch {
        const refusal = sourceVerificationRefusal();
        if (refusal && sourceConnection() === connection)
            return { status: refusal };
        // Covers direct import callers as well as SourceSyncService mutations.
        invalidateSourceVerification();
        throw new Error('SOURCE_SYNC.OFFLINE');
    }
}
