import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import { SourceServerTransport } from './source-server-transport';

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
