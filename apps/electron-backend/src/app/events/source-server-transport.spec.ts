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
