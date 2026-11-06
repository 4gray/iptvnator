import { favoriteReferenceKey } from '@iptvnator/shared/interfaces/favorites-sync';
import {
    createRandomId,
    type SourceServerRequest,
    type SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    emptyHistoryRecord,
    projectHistory,
    retainLocalHistory,
    parseHistoryScope,
    parseHistoryOperation,
    assertHistoryState,
    type HistoryScope,
    type HistoryStore,
    type HistoryOperation,
    type HistoryResult,
    type HistoryState,
} from '@iptvnator/shared/interfaces/history-sync';
export interface HistoryOptions {
    instanceId: string;
    deviceId: string;
    consent(): string | null;
    active(scope?: HistoryScope): boolean;
    request(value: SourceServerRequest): Promise<SourceServerResponse>;
    changed(): void;
    contexts?: HistoryScope[];
    remember(contexts: HistoryScope[]): void;
}
export class HistorySyncClient {
    readonly contexts = new Map<string, HistoryScope>();
    private readonly reads = new Map<string, number>();
    private readonly sending = new Map<string, Promise<void>>();
    private readonly writes = new Map<string, Promise<void>>();
    constructor(
        readonly store: HistoryStore,
        readonly options: HistoryOptions
    ) {
        for (const scope of options.contexts ?? [])
            this.contexts.set(scope.sourceId, parseHistoryScope(scope));
    }
    private rememberContexts(): void {
        this.options.remember(
            [...this.contexts.keys()].sort().map((id) => this.contexts.get(id)!)
        );
    }
    current(scope?: HistoryScope): void {
        if (
            !this.options.active(scope) ||
            (scope &&
                this.contexts.get(scope.sourceId)?.sourceIncarnation !==
                    scope.sourceIncarnation)
        )
            throw new Error('History scope superseded');
    }
    async refresh(sourceId: string): Promise<HistoryScope> {
        const generation = this.options.consent();
        if (!generation) throw new Error('History consent disabled');
        const sequence = (this.reads.get(sourceId) ?? 0) + 1;
        this.reads.set(sourceId, sequence);
        const response = await this.options.request({
            operation: 'history-read',
            id: sourceId,
        });
        this.current();
        if (
            this.options.consent() !== generation ||
            this.reads.get(sourceId) !== sequence
        )
            throw new Error('History refresh superseded');
        if (response.status !== 200) {
            if ([404, 409].includes(response.status)) {
                this.contexts.delete(sourceId);
                this.rememberContexts();
            }
            throw new Error(
                response.status >= 500
                    ? 'History offline'
                    : 'History unavailable'
            );
        }
        const body = response.body as {
            scope: HistoryScope;
            state: HistoryState;
        };
        const scope = parseHistoryScope(body.scope);
        assertHistoryState(body.state);
        if (
            scope.sourceId !== sourceId ||
            scope.instanceId !== this.options.instanceId
        )
            throw new Error('History response scope mismatch');
        this.contexts.set(sourceId, scope);
        this.rememberContexts();
        await this.store.mutate(scope, (current) => {
            this.current(scope);
            if (this.options.consent() !== generation)
                throw new Error('History consent changed');
            const record = current ?? emptyHistoryRecord();
            return body.state.revision >= record.base.revision
                ? { ...record, base: body.state }
                : record;
        });
        this.options.changed();
        return scope;
    }
    async scope(sourceId: string): Promise<HistoryScope> {
        // Previously verified scopes permit offline writes; unknown sources stay local in the raw store.
        const cached = this.contexts.get(sourceId);
        this.current(cached);
        if (cached) return cached;
        return this.refresh(sourceId);
    }
    async state(sourceId: string) {
        const scope = this.contexts.get(sourceId);
        this.current(scope);
        if (!scope) return null;
        const record = await this.store.read(scope);
        this.current(scope);
        return {
            ...projectHistory(record ?? emptyHistoryRecord()),
            hideArchive: record?.hideArchive,
        };
    }
    async command(
        sourceId: string,
        input: Pick<HistoryOperation, 'kind' | 'reference' | 'snapshot'>,
        localOnly = false
    ): Promise<void> {
        const generation = localOnly ? null : this.options.consent();
        const captured = this.contexts.get(sourceId);
        const next = (this.writes.get(sourceId) ?? Promise.resolve())
            .catch(() => undefined)
            .then(() => {
                this.current(captured);
                return this.commitCommand(sourceId, input, generation);
            });
        this.writes.set(sourceId, next);
        try {
            await next;
        } finally {
            if (this.writes.get(sourceId) === next)
                this.writes.delete(sourceId);
        }
    }
    private async commitCommand(
        sourceId: string,
        input: Pick<HistoryOperation, 'kind' | 'reference' | 'snapshot'>,
        generation: string | null
    ): Promise<void> {
        const scope = await this.scope(sourceId);
        this.current(scope);
        const operationId = createRandomId();
        await this.store.mutate(scope, (current) => {
            this.current(scope);
            const record = current ?? emptyHistoryRecord();
            const previous =
                input.kind === 'touch'
                    ? [...record.pending]
                          .reverse()
                          .find(
                              ({ operation }) =>
                                  operation.deviceId ===
                                      this.options.deviceId &&
                                  (operation.kind === 'clear' ||
                                      (operation.kind === 'remove' &&
                                          operation.reference &&
                                          input.reference &&
                                          favoriteReferenceKey(
                                              operation.reference
                                          ) ===
                                              favoriteReferenceKey(
                                                  input.reference
                                              )))
                          )?.operation
                    : undefined;
            const operation = parseHistoryOperation({
                ...input,
                operationId,
                deviceId: this.options.deviceId,
                baseRevision: record.base.revision,
                viewedAt: Date.now(),
                ...(previous?.deviceId === this.options.deviceId
                    ? { after: previous.operationId }
                    : {}),
            });
            if (
                operation.reference &&
                operation.reference.provider !== scope.provider
            )
                throw new Error('History provider mismatch');
            record.archive = retainLocalHistory(
                record.archive ?? [],
                operation
            );
            if (!generation || this.options.consent() !== generation) {
                if (operation.kind === 'clear')
                    return {
                        ...record,
                        hideArchive: true,
                        local: projectHistory(record).items.map((item) => ({
                            ...operation,
                            kind: 'remove',
                            reference: item.reference,
                        })),
                    };
                return {
                    ...record,
                    local: retainLocalHistory(record.local, operation),
                };
            }
            return {
                ...record,
                ...(operation.kind === 'clear' ? { hideArchive: true } : {}),
                pending: [
                    ...record.pending,
                    { consent: generation, operation },
                ],
                local:
                    input.kind === 'clear'
                        ? []
                        : record.local.filter(
                              (op) =>
                                  op.kind === 'clear' ||
                                  JSON.stringify(op.reference) !==
                                      JSON.stringify(operation.reference)
                          ),
            };
        });
        this.options.changed();
        // Network failures never change the successful local commit into a failed history action.
        void this.flush(sourceId).catch(() => undefined);
    }
    flush(sourceId: string): Promise<void> {
        const active = this.sending.get(sourceId);
        if (active) return active;
        const task = this.deliver(sourceId).finally(() =>
            this.sending.delete(sourceId)
        );
        this.sending.set(sourceId, task);
        return task;
    }
    private async deliver(sourceId: string): Promise<void> {
        const generation = this.options.consent();
        const scope = this.contexts.get(sourceId);
        if (!generation || !scope) return;
        for (;;) {
            this.current(scope);
            if (generation !== this.options.consent()) return;
            const record = await this.store.read(scope);
            this.current(scope);
            if (generation !== this.options.consent()) return;
            const head = record?.pending[0];
            if (!head || head.consent !== generation) return;
            const response = await this.options.request({
                operation: 'history-apply',
                history: { scope, operation: head.operation },
            });
            this.current(scope);
            if (generation !== this.options.consent()) return;
            if (response.status !== 200)
                throw new Error('History delivery failed');
            const result = response.body as HistoryResult;
            assertHistoryState(result.state);
            if (typeof result.applied !== 'boolean')
                throw new Error('Invalid history receipt');
            await this.store.mutate(scope, (current) => {
                this.current(scope);
                if (generation !== this.options.consent()) return current!;
                if (!current)
                    throw new Error('History acknowledgement missing');
                const found = current.pending.find(
                    (p) =>
                        p.operation.operationId === head.operation.operationId
                );
                if (!found) return current;
                const same = (op: HistoryOperation) =>
                    op.kind === 'clear' ||
                    (op.reference &&
                        head.operation.reference &&
                        favoriteReferenceKey(op.reference) ===
                            favoriteReferenceKey(head.operation.reference));
                const later =
                    current.pending
                        .slice(current.pending.indexOf(found) + 1)
                        .some((p) => same(p.operation)) ||
                    current.local.some(same);

                return {
                    ...current,
                    base:
                        result.state.revision >= current.base.revision
                            ? result.state
                            : current.base,
                    pending: current.pending.filter(
                        (p) =>
                            p.operation.operationId !==
                            head.operation.operationId
                    ),
                    local:
                        result.applied || later
                            ? current.local
                            : [head.operation, ...current.local].reduce(
                                  retainLocalHistory,
                                  [] as HistoryOperation[]
                              ),
                };
            });
            this.options.changed();
        }
    }
    async parked(sourceId: string, send: boolean): Promise<void> {
        const scope = await this.scope(sourceId);
        const generation = this.options.consent();
        const snapshot = await this.store.read(scope);
        this.current(scope);
        if (!snapshot?.pending.some((p) => p.consent !== generation)) return;
        await this.store.mutate(scope, (current) => {
            this.current(scope);
            const record = current ?? emptyHistoryRecord();
            if (generation !== this.options.consent())
                throw new Error('History consent changed');
            const parked = record.pending.filter(
                (p) => p.consent !== generation
            );
            if (!parked.length) return record;
            if (send) {
                if (!generation || generation !== this.options.consent())
                    throw new Error('History consent changed');
                return {
                    ...record,
                    pending: record.pending.map((p) => ({
                        ...p,
                        consent: generation,
                    })),
                };
            }
            const parkedIds = new Set(
                parked.map((p) => p.operation.operationId)
            );
            const pending = record.pending
                .filter((p) => p.consent === generation)
                .map((p) => {
                    if (!p.operation.after || !parkedIds.has(p.operation.after))
                        return p;
                    // The parked head blocked delivery, so this successor has never been sent.
                    const operation = { ...p.operation };
                    delete operation.after;
                    return { ...p, operation };
                });
            const all = parked.map((p) => p.operation);
            const references = new Map(
                [
                    ...record.base.items.map((item) => item.reference),
                    ...[...all, ...record.local].reduce<
                        NonNullable<HistoryOperation['reference']>[]
                    >((refs, op) => {
                        if (op.reference) refs.push(op.reference);
                        return refs;
                    }, []),
                ].map((ref) => [favoriteReferenceKey(ref), ref])
            );
            const converted = all
                .reduce<HistoryOperation[]>(
                    (kept, op) =>
                        op.kind === 'clear'
                            ? [...references.values()].map((reference) => ({
                                  ...op,
                                  kind: 'remove',
                                  reference,
                              }))
                            : retainLocalHistory(kept, op),
                    []
                )
                .filter(
                    (op) =>
                        !pending.some(
                            (p) =>
                                p.operation.kind === 'clear' ||
                                (p.operation.reference &&
                                    op.reference &&
                                    favoriteReferenceKey(
                                        p.operation.reference
                                    ) === favoriteReferenceKey(op.reference))
                        )
                );
            const local = [...converted, ...record.local].reduce(
                retainLocalHistory,
                [] as HistoryOperation[]
            );
            return { ...record, pending, local };
        });
        this.options.changed();
        if (send) await this.flush(sourceId);
        else void this.flush(sourceId).catch(() => undefined);
    }
}
