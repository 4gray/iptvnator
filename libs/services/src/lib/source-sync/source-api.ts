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
import { isServerAccessChallenge } from '../server-access-token';
import {
    sourceConnection,
    invalidateSourceVerification,
    pairedBrowserTokenKey,
} from './source-connection';
import { sourceRequestRoute } from './source-request-route';
export { sourceRequestRoute } from './source-request-route';

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
    if (
        request.operation === 'tmdb-transfer' &&
        request.tmdbTransfer?.connection !== connection
    )
        return { status: 409, body: { code: 'instance_changed' } };
    if (window.electron?.sourceSyncRequest) {
        try {
            const response = await window.electron.sourceSyncRequest(request);
            if (
                ((response.status === 401 || response.status === 403) &&
                    !isProfilePinRefusal(
                        request,
                        response.status,
                        response.body
                    )) ||
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
    const authorization =
        request.operation === 'instance' ? {} : sourceAuthorization(url);
    let discoveryRefusal: number | undefined;
    const payload = isProfileOperation(request.operation)
        ? request.profile
        : request.operation === 'tmdb-transfer'
          ? request.tmdbTransfer?.request
          : (request.history ??
            request.favorite ??
            request.activity ??
            request.source);
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
                ...authorization,
                'Content-Type': 'application/json',
                'X-IPTVnator-Instance-Id': connection.instanceId,
                ...(request.operation === 'create'
                    ? { 'If-None-Match': '*' }
                    : {}),
                ...revisionHeaders(request),
            },
            ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        // These routes are server-owned; JSON 5xx responses are outages too.
        if (response.status >= 500) throw new Error('SOURCE_SYNC.OFFLINE');
        if (
            response.status === 401 &&
            authorization['Authorization'] &&
            isServerAccessChallenge(response.status, response.headers.get('www-authenticate'))
        ) {
            const key = pairedBrowserTokenKey(connection);
            // A late refusal must keep a newer pairing completed in another tab.
            if (
                key &&
                authorization['Authorization'] === `Bearer ${localStorage.getItem(key)}`
            )
                localStorage.removeItem(key);
        }
        if (
            response.status === 401 ||
            (response.status === 403 && !isProfileOperation(request.operation))
        )
            rejectSourceInstance(response.status, connection);
        else if (request.operation === 'instance' && response.status >= 400)
            rejectSourceInstance(409, connection);
        const body =
            response.status === 304 ||
            // A 204 has no body, except where discovery must still reject it.
            (response.status === 204 && request.operation !== 'instance') ||
            (response.status === 404 &&
                (request.operation === 'instance' ||
                    request.operation === 'tmdb-transfer'))
                ? undefined
                : await response.json().catch((error) => {
                      if (request.operation === 'instance') {
                          const { status } = response;
                          discoveryRefusal =
                              status === 401 || status === 403 ? status : 409;
                          if (status < 400)
                              rejectSourceInstance(
                                  discoveryRefusal,
                                  connection
                              );
                      }
                      throw error;
                  });
        if (
            response.status === 403 &&
            isProfileOperation(request.operation) &&
            !isProfilePinRefusal(request, response.status, body)
        )
            rejectSourceInstance(response.status, connection);
        if (
            request.operation !== 'instance' &&
            response.status === 409 &&
            body?.code === 'instance_changed'
        )
            rejectSourceInstance(409, connection);
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        return {
            status: response.status,
            etag: response.headers.get('etag') ?? undefined,
            ...(response.status === 304 || response.status === 204
                ? {}
                : { body }),
            ...(retryAfter !== undefined ? { retryAfter } : {}),
        };
    } catch {
        // An anonymous probe reports only a refusal from its own response.
        const refusal =
            request.operation === 'instance'
                ? discoveryRefusal
                : sourceVerificationRefusal();
        if (refusal && sourceConnection() === connection)
            return { status: refusal };
        // Covers direct import callers as well as SourceSyncService mutations.
        invalidateSourceVerification();
        throw new Error('SOURCE_SYNC.OFFLINE');
    }
}

/**
 * A profile list revalidates against its revision; the other profile routes
 * take no conditional headers, whatever the caller sets.
 */
function revisionHeaders(request: SourceServerRequest): Record<string, string> {
    if (request.operation === 'profiles-list')
        return request.revision && /^\d+$/.test(request.revision)
            ? { 'If-None-Match': `"profiles-${request.revision}"` }
            : {};
    if (isProfileOperation(request.operation) || !request.revision) return {};
    return {
        [request.operation === 'list' ? 'If-None-Match' : 'If-Match']:
            request.revision,
    };
}

function isProfileOperation(
    operation: SourceServerRequest['operation']
): boolean {
    return [
        'profiles-list',
        'profiles-set-enabled',
        'profiles-order',
        'profile-create',
        'profile-update',
        'profile-delete',
        'profile-unlock',
    ].includes(operation);
}

function isProfilePinRefusal(
    request: SourceServerRequest,
    status: number,
    body: unknown
): boolean {
    return (
        isProfileOperation(request.operation) &&
        status === 403 &&
        !!body &&
        typeof body === 'object' &&
        'code' in body &&
        ((body as { code?: unknown }).code === 'pin_required' ||
            (body as { code?: unknown }).code === 'wrong_pin')
    );
}

function parseRetryAfter(value: string | null): number | undefined {
    if (!value || !/^\d+$/.test(value)) return undefined;
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
}
