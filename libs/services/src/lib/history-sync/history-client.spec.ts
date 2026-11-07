import { HistorySyncClient } from './history-client';
import {
    emptyHistoryRecord,
    emptyHistoryState,
    applyHistoryOperation,
    visibleHistory,
    type HistoryRecord,
    type HistoryScope,
    type HistoryStore,
    type HistoryState,
    type HistoryOperation,
} from '@iptvnator/shared/interfaces/history-sync';
const scope: HistoryScope = {
    instanceId: 'nas',
    sourceId: 'source',
    sourceIncarnation: 'first',
    provider: 'xtream',
};
const reference = {
    provider: 'xtream' as const,
    kind: 'movie' as const,
    id: '42',
};
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
class Store implements HistoryStore {
    records = new Map<string, HistoryRecord>();
    async read(s: HistoryScope) {
        return copy(this.records.get(s.sourceIncarnation) ?? null);
    }
    async mutate(
        s: HistoryScope,
        update: (v: HistoryRecord | null) => HistoryRecord
    ) {
        const value = copy(update(await this.read(s)));
        this.records.set(s.sourceIncarnation, value);
        return copy(value);
    }
}
function fixture(store = new Store()) {
    let consent: string | null = 'first';
    let online = true;
    let active = true;
    let remote = emptyHistoryState();
    let incarnation = 'first';
    const receipts = new Map<
        string,
        { operation: HistoryOperation; state: HistoryState }
    >();
    const request = jest.fn(async (req) => {
        if (!online) throw new Error('offline');
        if (req.operation === 'history-read')
            return {
                status: 200,
                body: {
                    scope: { ...scope, sourceIncarnation: incarnation },
                    state: copy(remote),
                },
            };
        const operation = req.history.operation as HistoryOperation;
        let saved = receipts.get(operation.operationId);
        if (!saved) {
            const applied = applyHistoryOperation(
                remote,
                operation,
                false,
                Date.now()
            );
            remote = applied.state;
            saved = { operation, state: copy(remote) };
            receipts.set(operation.operationId, saved);
            return { status: 200, body: { ...applied, state: copy(remote) } };
        }
        return { status: 200, body: { applied: true, state: copy(remote) } };
    });
    const options = {
        instanceId: 'nas',
        deviceId: 'device',
        consent: () => consent,
        active: () => active,
        request,
        changed: jest.fn(),
        remember: jest.fn(),
        contexts: [scope],
    };
    return {
        store,
        request,
        options,
        client: new HistorySyncClient(store, options),
        consent: (v: string | null) => (consent = v),
        online: (v: boolean) => (online = v),
        active: (v: boolean) => (active = v),
        remote: (v: HistoryState) => (remote = v),
        incarnation: (v: string) => (incarnation = v),
    };
}
describe('history delivery and consent', () => {
    it('chains a rewatch only to its relevant remove or source clear, skipping unrelated touches', async () => {
        const f = fixture();
        f.online(false);
        const other = { ...reference, id: '43' };
        await f.client.command('source', { kind: 'remove', reference });
        await f.client.command('source', { kind: 'touch', reference: other });
        await f.client.command('source', { kind: 'touch', reference });
        const pending = (await f.store.read(scope))!.pending;
        expect(pending[1].operation.after).toBeUndefined();
        expect(pending[2].operation.after).toBe(
            pending[0].operation.operationId
        );
        await f.client.command('source', { kind: 'clear' });
        await f.client.command('source', { kind: 'touch', reference: other });
        const next = (await f.store.read(scope))!.pending;
        expect(next[4].operation.after).toBe(next[3].operation.operationId);
    });
    it('keeping a parked source local leaves another source current queue untouched', async () => {
        const f = fixture();
        f.online(false);
        const other = {
            ...scope,
            sourceId: 'other-source',
            sourceIncarnation: 'other-incarnation',
        };
        f.client.contexts.set(other.sourceId, other);
        await f.client.command('source', { kind: 'touch', reference });
        f.consent('new');
        await f.client.command(other.sourceId, { kind: 'touch', reference });
        await f.client.parked('source', false);
        await f.client.parked(other.sourceId, false);
        expect((await f.store.read(scope))?.pending).toHaveLength(0);
        expect((await f.store.read(other))?.pending).toHaveLength(1);
    });
    it('keeps current-generation successors queued when an older removal stays local', async () => {
        const f = fixture();
        f.online(false);
        await f.client.command('source', { kind: 'remove', reference });
        f.consent('new');
        await f.client.command('source', { kind: 'touch', reference });
        await f.client.parked('source', false);
        const record = await f.store.read(scope);
        expect(record?.pending).toHaveLength(1);
        expect(record?.pending[0].operation.after).toBeUndefined();
        expect(record?.local).toEqual([]);
        await f.client.flush('source').catch(() => undefined);
        f.online(true);
        await f.client.flush('source');
        expect(visibleHistory((await f.client.state('source'))!)).toHaveLength(
            1
        );
    });
    it('does not apply an old keep-local choice after consent changes during storage work', async () => {
        const f = fixture();
        f.online(false);
        await f.client.command('source', { kind: 'touch', reference });
        f.consent('new');
        const mutate = f.store.mutate.bind(f.store);
        jest.spyOn(f.store, 'mutate').mockImplementationOnce(
            async (scope, update) => {
                f.consent('newer');
                return mutate(scope, update);
            }
        );
        await expect(f.client.parked('source', false)).rejects.toThrow(
            'consent changed'
        );
        expect((await f.store.read(scope))?.pending[0].consent).toBe('first');
    });
    it('persists stable context order across discovery, polling and retirement', async () => {
        const f = fixture();
        const alpha = { ...scope, sourceId: 'alpha' };
        const zeta = { ...scope, sourceId: 'zeta' };
        f.client.contexts.clear();
        f.client.contexts.set('zeta', zeta);
        f.client.contexts.set('alpha', alpha);
        await f.client.refresh('source');
        expect(f.options.remember).toHaveBeenLastCalledWith([
            alpha,
            scope,
            zeta,
        ]);
        f.client.contexts.delete('zeta');
        f.client.contexts.set('zeta', zeta);
        f.remote({ revision: 2, cleared: 2, items: [] });
        await f.client.refresh('source');
        expect(f.options.remember).toHaveBeenLastCalledWith([
            alpha,
            scope,
            zeta,
        ]);
        expect((await f.store.read(scope))?.base.revision).toBe(2);
        f.request.mockImplementation(
            async () => ({ status: 404, body: {} }) as never
        );
        await expect(f.client.refresh('source')).rejects.toThrow('unavailable');
        expect(f.options.remember).toHaveBeenLastCalledWith([alpha, zeta]);
        await expect(f.client.refresh('source')).rejects.toThrow('unavailable');
        expect(f.options.remember).toHaveBeenLastCalledWith([alpha, zeta]);
    });
    it('enabling reads state without uploading existing local history', async () => {
        const f = fixture();
        await f.client.refresh('source');
        expect(
            f.request.mock.calls.every(([r]) => r.operation === 'history-read')
        ).toBe(true);
    });
    it('persists a confirmed watch and intent before attempting network; recovers after restart', async () => {
        const f = fixture();
        f.online(false);
        await f.client.command('source', { kind: 'touch', reference });
        await expect(f.client.flush('source')).rejects.toThrow();
        expect((await f.store.read(scope))?.pending).toHaveLength(1);
        expect(visibleHistory((await f.client.state('source'))!)).toHaveLength(
            1
        );
        f.online(true);
        const restarted = new HistorySyncClient(f.store, f.options);
        await restarted.flush('source');
        expect((await f.store.read(scope))?.pending).toHaveLength(0);
        expect(visibleHistory((await restarted.state('source'))!)).toHaveLength(
            1
        );
    });
    it('orders overlapping local watch and clear invocations even while the first write waits', async () => {
        const f = fixture();
        f.consent(null);
        const mutate = f.store.mutate.bind(f.store);
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => (release = resolve));
        let calls = 0;
        f.store.mutate = async (s, update) => {
            if (++calls === 1) await blocked;
            return mutate(s, update);
        };
        const watch = f.client.command('source', { kind: 'touch', reference });
        const clear = f.client.command('source', { kind: 'clear' });
        for (let i = 0; i < 8; i++) await Promise.resolve();
        expect(calls).toBe(1);
        release();
        await Promise.all([watch, clear]);
        expect(visibleHistory((await f.client.state('source'))!)).toEqual([]);
    });
    it('does not replay an older consent until the user explicitly chooses send', async () => {
        const f = fixture();
        f.online(false);
        await f.client.command('source', { kind: 'touch', reference });
        await f.client.flush('source').catch(() => undefined);
        f.consent('new');
        f.online(true);
        f.request.mockClear();
        await f.client.flush('source');
        expect(f.request).not.toHaveBeenCalled();
        await f.client.parked('source', true);
        expect((await f.store.read(scope))?.pending).toHaveLength(0);
    });
    it('keeps paused queues locally and local removals survive re-enable', async () => {
        const f = fixture();
        f.online(false);
        await f.client.command('source', { kind: 'touch', reference });
        await f.client.flush('source').catch(() => undefined);
        f.consent(null);
        await f.client.command('source', { kind: 'remove', reference });
        f.consent('new');
        await f.client.parked('source', false);
        expect(visibleHistory((await f.client.state('source'))!)).toEqual([]);
        expect((await f.store.read(scope))?.pending).toHaveLength(0);
    });
    it.each(['opt-out', 'consent', 'profile', 'source'] as const)(
        'sends no request if %s changes during a pending queue read',
        async (change) => {
            const f = fixture();
            await f.store.mutate(scope, () => ({
                ...emptyHistoryRecord(),
                pending: [
                    {
                        consent: 'first',
                        operation: {
                            kind: 'touch',
                            reference,
                            operationId: 'queued',
                            deviceId: 'device',
                            baseRevision: 0,
                            viewedAt: 1,
                        },
                    },
                ],
            }));
            const read = f.store.read.bind(f.store);
            let release!: () => void;
            const blocked = new Promise<void>((resolve) => (release = resolve));
            jest.spyOn(f.store, 'read').mockImplementationOnce(
                async (address) => {
                    await blocked;
                    return read(address);
                }
            );
            const sending = f.client.flush('source');
            expect(f.store.read).toHaveBeenCalledTimes(1);
            if (change === 'opt-out') f.consent(null);
            else if (change === 'consent') f.consent('replacement');
            else if (change === 'profile') f.active(false);
            else
                f.client.contexts.set('source', {
                    ...scope,
                    sourceIncarnation: 'replacement',
                });
            release();
            if (change === 'profile' || change === 'source')
                await expect(sending).rejects.toThrow('superseded');
            else await expect(sending).resolves.toBeUndefined();
            expect(f.request).not.toHaveBeenCalled();
            expect((await read(scope))?.pending).toHaveLength(1);
        }
    );
    it('late ack after opt-out cannot remove the queue or a new local action', async () => {
        const f = fixture();
        let release!: (v: unknown) => void;
        const blocked = new Promise((resolve) => (release = resolve));
        const original = f.request.getMockImplementation()!;
        f.request.mockImplementation(async (req) =>
            req.operation === 'history-apply'
                ? (blocked as never)
                : original(req)
        );
        await f.client.command('source', { kind: 'touch', reference });
        f.consent(null);
        await f.client.command('source', { kind: 'clear' });
        release({
            status: 200,
            body: {
                applied: true,
                state: applyHistoryOperation(emptyHistoryState(), {
                    kind: 'touch',
                    reference,
                    operationId: 'server',
                    deviceId: 'device',
                    baseRevision: 0,
                    viewedAt: 1,
                }).state,
            },
        });
        await f.client.flush('source');
        const record = await f.store.read(scope);
        expect(record?.pending).toHaveLength(1);
        expect(record?.local).toHaveLength(1);
        expect(visibleHistory((await f.client.state('source'))!)).toEqual([]);
    });
    it('an older acknowledgement does not overwrite a newer polled server base', async () => {
        const f = fixture();
        let release!: (v: unknown) => void;
        f.request.mockImplementation(
            async () => new Promise((resolve) => (release = resolve)) as never
        );
        await f.client.command('source', { kind: 'touch', reference });
        await f.store.mutate(scope, (current) => ({
            ...current!,
            base: { revision: 10, cleared: 10, items: [] },
        }));
        release({
            status: 200,
            body: {
                applied: true,
                state: { revision: 1, cleared: 0, items: [] },
            },
        });
        await f.client.flush('source');
        expect((await f.store.read(scope))?.base.revision).toBe(10);
    });
    it('a source replacement isolates the old queue and profile changes reject writes', async () => {
        const f = fixture();
        f.online(false);
        await f.client.command('source', { kind: 'touch', reference });
        await f.client.flush('source').catch(() => undefined);
        f.online(true);
        f.incarnation('second');
        await f.client.refresh('source');
        await f.client.flush('source');
        expect((await f.store.read(scope))?.pending).toHaveLength(1);
        expect(visibleHistory((await f.client.state('source'))!)).toEqual([]);
        f.active(false);
        await expect(
            f.client.command('source', { kind: 'clear' })
        ).rejects.toThrow('superseded');
    });
    it('retains a rejected stale touch locally behind a remote clear', async () => {
        const f = fixture();
        f.online(false);
        await f.client.command('source', { kind: 'touch', reference });
        await f.client.flush('source').catch(() => undefined);
        f.remote({ revision: 5, cleared: 5, items: [] });
        f.online(true);
        await f.client.refresh('source');
        await f.client.flush('source');
        expect((await f.store.read(scope))?.local).toHaveLength(1);
        expect(visibleHistory((await f.client.state('source'))!)).toHaveLength(
            1
        );
    });
    it.each([404, 409, 503])(
        'retires unavailable sources but keeps verified offline queues for HTTP %s',
        async (status) => {
            const f = fixture();
            f.request.mockImplementation(
                async () => ({ status, body: {} }) as never
            );
            await expect(f.client.refresh('source')).rejects.toThrow(
                status === 503 ? 'offline' : 'unavailable'
            );
            expect(f.client.contexts.has('source')).toBe(status === 503);
            if (status === 503) {
                await f.client.command('source', { kind: 'touch', reference });
                await f.client.flush('source').catch(() => undefined);
                expect((await f.store.read(scope))?.pending).toHaveLength(1);
            } else expect(f.options.remember).toHaveBeenLastCalledWith([]);
        }
    );
    it.each(['sourceId', 'instanceId'] as const)(
        'rejects a server response for a different %s before storing it',
        async (field) => {
            const f = fixture();
            f.request.mockImplementation(
                async () =>
                    ({
                        status: 200,
                        body: {
                            scope: { ...scope, [field]: 'synthetic-other' },
                            state: emptyHistoryState(),
                        },
                    }) as never
            );
            await expect(f.client.refresh('source')).rejects.toThrow(
                'scope mismatch'
            );
            expect(f.options.remember).not.toHaveBeenCalled();
            expect(await f.store.read(scope)).toBeNull();
        }
    );
    it('does not roll back a newer cached server revision during refresh', async () => {
        const f = fixture();
        await f.store.mutate(scope, () => ({
            ...emptyHistoryRecord(),
            base: { revision: 10, cleared: 10, items: [] },
        }));
        await f.client.refresh('source');
        expect((await f.store.read(scope))?.base.revision).toBe(10);
    });
    it.each(['http', 'receipt', 'state'] as const)(
        'retains the queued intent when the server returns an invalid %s',
        async (failure) => {
            const f = fixture();
            f.request.mockImplementation(
                async () =>
                    ({
                        status: failure === 'http' ? 500 : 200,
                        body: {
                            applied:
                                failure === 'receipt' ? 'unexpected' : true,
                            state:
                                failure === 'state'
                                    ? { revision: -1, cleared: 0, items: [] }
                                    : emptyHistoryState(),
                        },
                    }) as never
            );
            await f.client.command('source', { kind: 'touch', reference });
            await expect(f.client.flush('source')).rejects.toThrow();
            expect((await f.store.read(scope))?.pending).toHaveLength(1);
            expect(
                visibleHistory((await f.client.state('source'))!)
            ).toHaveLength(1);
        }
    );
    it('rejects a cross-provider command before writing or sending it', async () => {
        const f = fixture();
        await expect(
            f.client.command('source', {
                kind: 'touch',
                reference: { provider: 'stalker', kind: 'movie', id: '42' },
            })
        ).rejects.toThrow('provider mismatch');
        expect(await f.store.read(scope)).toBeNull();
        expect(f.request).not.toHaveBeenCalled();
    });
});
