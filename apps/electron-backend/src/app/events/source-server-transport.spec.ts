import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import { SourceServerTransport } from './source-server-transport';

it.each([
    [{ status: 401 }, 'LOCKED'],
    [{ status: 403 }, 'LOCKED'],
    [{ status: 404 }, 'INCOMPATIBLE'],
    [{ status: 400 }, 'INCOMPATIBLE'],
    [{ status: 204 }, 'INCOMPATIBLE'],
    [
        { status: 200, body: { instanceId: 'selected', storage: 'none' } },
        'INCOMPATIBLE',
    ],
    [{ status: 200, body: { instanceId: 'other' } }, 'INSTANCE_CHANGED'],
    [{ status: 503 }, 'OFFLINE'],
])('preserves a rejected instance probe (%j)', async (response, code) => {
    const send = jest.fn().mockResolvedValue(response);
    const token = jest.fn(() => 'synthetic-token');
    await expect(
        new SourceServerTransport(send).execute(
            { apiUrl: 'https://synthetic.invalid/api', instanceId: 'selected' },
            { operation: 'favorites-context', id: 'source' },
            token
        )
    ).rejects.toThrow(`SOURCE_SYNC.${code}`);
    expect(token).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
});

it('keeps profile verification isolated when an older connection probe finishes late', async () => {
    const original = { apiUrl: 'https://nas.test/api', instanceId: 'original' };
    const selected = { ...original, instanceId: 'selected' };
    let release!: (response: SourceServerResponse) => void;
    const send = jest.fn(
        async (
            _url: string,
            _token: string,
            request: SourceServerRequest,
            instanceId?: string
        ): Promise<SourceServerResponse> => ({
            status: 200,
            body:
                request.operation === 'instance'
                    ? {
                          service: 'iptvnator',
                          apiVersion: 1,
                          storage: 'server',
                          instanceId,
                          capabilities: ['sources-v1'],
                      }
                    : { entries: [] },
        })
    );
    send.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                release = resolve;
            })
    );
    const transport = new SourceServerTransport(send);
    const originalToken = jest.fn(() => 'original-token');
    const selectedToken = jest.fn(() => 'selected-token');
    const oldProbe = transport.execute(
        original,
        { operation: 'instance' },
        originalToken
    );
    await transport.execute(selected, { operation: 'list' }, selectedToken);
    expect(send.mock.calls[1]).toEqual([
        selected.apiUrl,
        '',
        { operation: 'instance' },
        selected.instanceId,
    ]);
    expect(send.mock.calls[2]).toEqual([
        selected.apiUrl,
        'selected-token',
        { operation: 'list' },
        selected.instanceId,
    ]);
    release({
        status: 200,
        body: {
            service: 'iptvnator',
            apiVersion: 1,
            storage: 'server',
            instanceId: original.instanceId,
            capabilities: ['sources-v1'],
        },
    });
    await expect(oldProbe).rejects.toThrow('SOURCE_SYNC.OFFLINE');
    await transport.execute(selected, { operation: 'list' }, selectedToken);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[3][1]).toBe('selected-token');
    expect(originalToken).not.toHaveBeenCalled();
});

it('keeps verification after a profile PIN refusal and a profile delete', async () => {
    const send = jest.fn(
        async (
            _url: string,
            _token: string,
            request: SourceServerRequest,
            instanceId?: string
        ): Promise<SourceServerResponse> => {
            if (request.operation === 'instance')
                return {
                    status: 200,
                    body: {
                        service: 'iptvnator',
                        apiVersion: 1,
                        storage: 'server',
                        instanceId,
                        capabilities: ['sources-v1'],
                    },
                };
            if (request.operation === 'profile-unlock')
                return { status: 403, body: { code: 'wrong_pin' } };
            if (request.operation === 'profile-delete') return { status: 204 };
            return { status: 200, body: {} };
        }
    );
    const transport = new SourceServerTransport(send);
    const connection = { apiUrl: 'https://nas.test/api', instanceId: 'nas' };
    const token = () => 'synthetic-token';
    await transport.execute(
        connection,
        {
            operation: 'profile-unlock',
            id: '11111111-1111-4111-8111-111111111111',
            profile: { pin: '1234' },
        },
        token
    );
    await transport.execute(connection, { operation: 'profiles-list' }, token);
    await transport.execute(
        connection,
        {
            operation: 'profile-delete',
            id: '11111111-1111-4111-8111-111111111111',
        },
        token
    );
    await transport.execute(connection, { operation: 'profiles-list' }, token);
    expect(send.mock.calls.map(([, , request]) => request.operation)).toEqual([
        'instance',
        'profile-unlock',
        'profiles-list',
        'profile-delete',
        'profiles-list',
    ]);
});

it('revokes verification after a plain profile 403', async () => {
    const send = jest.fn(
        async (
            _url: string,
            _token: string,
            request: SourceServerRequest,
            instanceId?: string
        ): Promise<SourceServerResponse> =>
            request.operation === 'instance'
                ? {
                      status: 200,
                      body: {
                          service: 'iptvnator',
                          apiVersion: 1,
                          storage: 'server',
                          instanceId,
                          capabilities: ['sources-v1'],
                      },
                  }
                : request.operation === 'profile-unlock'
                  ? { status: 403, body: { code: 'forbidden' } }
                  : { status: 200, body: {} }
    );
    const transport = new SourceServerTransport(send);
    const connection = { apiUrl: 'https://nas.test/api', instanceId: 'nas' };
    await transport.execute(
        connection,
        {
            operation: 'profile-unlock',
            id: '11111111-1111-4111-8111-111111111111',
            profile: { pin: '1234' },
        },
        () => 'synthetic-token'
    );
    await transport.execute(
        connection,
        { operation: 'profiles-list' },
        () => 'synthetic-token'
    );
    expect(send.mock.calls.map(([, , request]) => request.operation)).toEqual([
        'instance',
        'profile-unlock',
        'instance',
        'profiles-list',
    ]);
});
