import type { SourceServerRequest } from '@iptvnator/shared/interfaces';

export function sourceRequestRoute(request: SourceServerRequest): {
    path: string;
    method: string;
} {
    const id = encodeURIComponent(request.id ?? '');
    switch (request.operation) {
        case 'tmdb-transfer':
            return { path: '/v1/tmdb-transfer', method: 'POST' };
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
        case 'profiles-list':
            return { path: '/v1/profiles', method: 'GET' };
        case 'profiles-set-enabled':
            return { path: '/v1/profiles', method: 'PATCH' };
        case 'profiles-order':
            return { path: '/v1/profiles/order', method: 'PUT' };
        case 'profile-create':
            return { path: '/v1/profiles', method: 'POST' };
        case 'profile-update':
            return { path: `/v1/profiles/${id}`, method: 'PATCH' };
        case 'profile-delete':
            return { path: `/v1/profiles/${id}`, method: 'DELETE' };
        case 'profile-unlock':
            return { path: `/v1/profiles/${id}/unlock`, method: 'POST' };
    }
}
