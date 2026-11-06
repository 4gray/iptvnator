import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import {
    REMEMBERED_SERVER_KEY,
    resolveServerStorageStart,
} from './server-storage-start';

const instance: ServerInstanceInfo = {
    service: 'iptvnator',
    apiVersion: 1,
    instanceId: 'i-1',
    storage: 'server',
    auth: 'none',
};

describe('resolveServerStorageStart', () => {
    afterEach(() => localStorage.clear());

    it('starts online and remembers a server that answered', () => {
        expect(
            resolveServerStorageStart({ kind: 'server', instance }, '/api')
        ).toEqual({ instance, startedOffline: false });
        expect(
            JSON.parse(localStorage.getItem(REMEMBERED_SERVER_KEY) ?? '')
        ).toEqual({ baseUrl: '/api', instance });
    });

    it('starts offline when a remembered server does not answer', () => {
        resolveServerStorageStart({ kind: 'server', instance }, '/api');

        expect(
            resolveServerStorageStart({ kind: 'unreachable' }, '/api')
        ).toEqual({ instance, startedOffline: true });
    });

    it('matches the remembered server however its URL is written', () => {
        resolveServerStorageStart({ kind: 'server', instance }, '/api');

        for (const spelling of ['/api/', ' /api', `${location.origin}/api//`]) {
            expect(
                resolveServerStorageStart({ kind: 'unreachable' }, spelling)
            ).toEqual({ instance, startedOffline: true });
        }
        expect(
            resolveServerStorageStart({ kind: 'unreachable' }, '/apis')
        ).toBeNull();
    });

    it('keeps the token only for the same server and database', () => {
        const token = 'iptvnator-server:access-token';
        resolveServerStorageStart({ kind: 'server', instance }, '/api');
        localStorage.setItem(token, 'secret');

        resolveServerStorageStart({ kind: 'server', instance }, '/api/');
        expect(localStorage.getItem(token)).toBe('secret');

        resolveServerStorageStart(
            { kind: 'server', instance: { ...instance, instanceId: 'i-2' } },
            '/api'
        );
        expect(localStorage.getItem(token)).toBeNull();

        localStorage.setItem(token, 'secret');
        resolveServerStorageStart(
            { kind: 'server', instance: { ...instance, instanceId: 'i-2' } },
            '/other'
        );
        expect(localStorage.getItem(token)).toBeNull();
    });

    it('forgets the token of a server that no longer offers storage', () => {
        localStorage.setItem('iptvnator-server:access-token', 'old');

        resolveServerStorageStart({ kind: 'none' }, '/api');

        expect(
            localStorage.getItem('iptvnator-server:access-token')
        ).toBeNull();
    });

    it('uses browser mode for an unknown or different server', () => {
        expect(
            resolveServerStorageStart({ kind: 'unreachable' }, '/api')
        ).toBeNull();

        resolveServerStorageStart({ kind: 'server', instance }, '/api');
        expect(
            resolveServerStorageStart(
                { kind: 'unreachable' },
                'http://other:3000'
            )
        ).toBeNull();
    });

    it('forgets the server once it answers without server storage', () => {
        resolveServerStorageStart({ kind: 'server', instance }, '/api');

        expect(resolveServerStorageStart({ kind: 'none' }, '/api')).toBeNull();
        expect(localStorage.getItem(REMEMBERED_SERVER_KEY)).toBeNull();
        expect(
            resolveServerStorageStart({ kind: 'unreachable' }, '/api')
        ).toBeNull();
    });

    it('ignores a skipped probe and unreadable memory', () => {
        resolveServerStorageStart({ kind: 'server', instance }, '/api');
        expect(
            resolveServerStorageStart({ kind: 'skipped' }, '/api')
        ).toBeNull();
        expect(localStorage.getItem(REMEMBERED_SERVER_KEY)).not.toBeNull();

        localStorage.setItem(REMEMBERED_SERVER_KEY, '{broken');
        expect(
            resolveServerStorageStart({ kind: 'unreachable' }, '/api')
        ).toBeNull();
        expect(
            resolveServerStorageStart({ kind: 'unreachable' }, '/api', null)
        ).toBeNull();
    });
});
