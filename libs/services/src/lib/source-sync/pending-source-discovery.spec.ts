import { recoverPendingStatelessBackend } from './pending-source-discovery';
import {
    prepareSourceConnection,
    sourceConnection,
    sourceProfileName,
    tokenKey,
} from './source-connection';

describe('temporary source-server discovery recovery', () => {
    const connection = {
        apiUrl: 'https://nas.test/api',
        instanceId: 'pending:https://nas.test/api',
    };
    const stateless = { service: 'iptvnator', apiVersion: 1, storage: 'none' };
    const electron = window.electron;
    beforeEach(async () => {
        Reflect.deleteProperty(window, 'electron');
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify(connection)
        );
        await prepareSourceConnection();
    });
    afterEach(() => {
        window.electron = electron;
    });

    it('clears only an unconfirmed selection and reloads back into the preserved standalone profile', async () => {
        sessionStorage.setItem(tokenKey(connection), 'pending-token');
        const reload = jest.fn();
        expect(
            recoverPendingStatelessBackend(connection, stateless, reload)
        ).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('iptvnator:source-server')).toBeNull();
        expect(
            localStorage.getItem('iptvnator:source-server-disabled')
        ).toBeNull();
        expect(sessionStorage.getItem(tokenKey(connection))).toBeNull();
        expect(sourceConnection()).toEqual(connection);
        await prepareSourceConnection();
        expect(sourceProfileName()).toBe('iptvnator');
    });
    it.each([
        { ...stateless, service: 'other' },
        { ...stateless, apiVersion: 2 },
        { ...stateless, storage: 'server' },
        null,
    ])(
        'retains pending discovery for an incompatible or non-stateless response: %s',
        (response) => {
            const reload = jest.fn();
            expect(
                recoverPendingStatelessBackend(connection, response, reload)
            ).toBe(false);
            expect(reload).not.toHaveBeenCalled();
            expect(
                localStorage.getItem('iptvnator:source-server')
            ).not.toBeNull();
        }
    );
    it('preserves a newer selection made in another tab while reloading the stale discovery tab', async () => {
        const newer = {
            apiUrl: 'https://new-nas.test/api',
            instanceId: 'confirmed-nas',
        };
        localStorage.setItem('iptvnator:source-server', JSON.stringify(newer));
        const reload = jest.fn();
        expect(
            recoverPendingStatelessBackend(connection, stateless, reload)
        ).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(
            JSON.parse(localStorage.getItem('iptvnator:source-server')!)
        ).toEqual(newer);
        await prepareSourceConnection();
        expect(sourceConnection()).toEqual(newer);
    });
    it('never abandons a confirmed source-server profile', () => {
        const reload = jest.fn();
        expect(
            recoverPendingStatelessBackend(
                { ...connection, instanceId: 'confirmed-nas' },
                stateless,
                reload
            )
        ).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });
    it('recovers a pending legacy endpoint on 404 without abandoning a confirmed instance', () => {
        const reload = jest.fn();
        expect(
            recoverPendingStatelessBackend(
                { ...connection, instanceId: 'confirmed' },
                undefined,
                reload,
                404
            )
        ).toBe(false);
        expect(
            recoverPendingStatelessBackend(connection, undefined, reload, 404)
        ).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('iptvnator:source-server')).toBeNull();
    });
    it('does not loop on reload if the saved connection cannot be removed', () => {
        const denied = jest
            .spyOn(Storage.prototype, 'removeItem')
            .mockImplementation(() => {
                throw new Error('Denied');
            });
        const reload = jest.fn();
        try {
            expect(() =>
                recoverPendingStatelessBackend(connection, stateless, reload)
            ).toThrow('SOURCE_SYNC.REQUEST_FAILED');
            expect(reload).not.toHaveBeenCalled();
        } finally {
            denied.mockRestore();
        }
    });
});
