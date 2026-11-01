import { ElectronActivityLocalStore } from './electron-activity-local';
import {
    emptyActivityState,
    type ActivityAddress,
    type ActivityLocalRecord,
    type ActivityLocalRequest,
} from '@iptvnator/shared/interfaces/activity-sync';

const address: ActivityAddress = {
    instanceId: 'synthetic-nas',
    scope: 'shared',
    sourceId: 'synthetic-source',
    sourceIncarnation: 'synthetic-generation',
    content: { provider: 'xtream', kind: 'vod', id: '42' },
};
const record = (): ActivityLocalRecord => ({
    state: emptyActivityState(),
    pending: [],
});

describe('Electron activity transaction adapter', () => {
    it('recomputes a mutation from the sibling window state after CAS conflicts', async () => {
        let current: ActivityLocalRecord | null = null;
        let attempts = 0;
        const send = jest.fn(
            async (request: ActivityLocalRequest): Promise<unknown> => {
                if (request.operation === 'read')
                    return structuredClone(current);
                if (request.operation !== 'commit')
                    throw new Error('Unexpected synthetic request');
                expect(request.expected).toBe(
                    current === null ? null : JSON.stringify(current)
                );
                if (++attempts === 1) {
                    current = {
                        ...record(),
                        state: { ...emptyActivityState(), revision: 8 },
                    };
                    return { conflict: true };
                }
                current = request.value;
                return { value: current };
            }
        );
        const store = new ElectronActivityLocalStore(address.instanceId, send);
        const value = await store.mutate(address, (previous) => ({
            ...record(),
            state: {
                ...emptyActivityState(),
                revision: (previous?.state.revision ?? 0) + 1,
            },
        }));
        expect(value.state.revision).toBe(9);
        expect(attempts).toBe(2);
    });
    it('stops contention after the bounded retry budget without acknowledging a write', async () => {
        const send = jest.fn(async (request: ActivityLocalRequest) =>
            request.operation === 'read' ? record() : { conflict: true }
        );
        const store = new ElectronActivityLocalStore(address.instanceId, send);
        await expect(store.mutate(address, () => record())).rejects.toThrow(
            'Activity storage busy'
        );
        expect(
            send.mock.calls.filter(
                ([request]) => request.operation === 'commit'
            )
        ).toHaveLength(20);
    });
    it('keeps list/pending reads bound to the selected server profile and propagates failures', async () => {
        const send = jest.fn(
            async (_request: ActivityLocalRequest): Promise<unknown> => []
        );
        const store = new ElectronActivityLocalStore(address.instanceId, send);
        await expect(store.entries(address.sourceId)).resolves.toEqual([]);
        await expect(store.pending()).resolves.toEqual([]);
        expect(send.mock.calls.map(([request]) => request)).toEqual([
            {
                operation: 'list',
                instanceId: address.instanceId,
                sourceId: address.sourceId,
            },
            { operation: 'pending', instanceId: address.instanceId },
        ]);
        send.mockRejectedValueOnce(new Error('Synthetic IPC failure'));
        await expect(store.read(address)).rejects.toThrow(
            'Synthetic IPC failure'
        );
    });
});
