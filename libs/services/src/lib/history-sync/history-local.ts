import {
    historyScopeKey,
    assertHistoryRecord,
    type HistoryStore,
    type HistoryRecord,
    type HistoryScope,
    type HistoryLocalRequest,
} from '@iptvnator/shared/interfaces/history-sync';
export class IndexedDbHistoryStore implements HistoryStore {
    constructor(private readonly instanceId: string) {}
    read(scope: HistoryScope): Promise<HistoryRecord | null> {
        return this.visit(scope);
    }
    mutate(
        scope: HistoryScope,
        update: (value: HistoryRecord | null) => HistoryRecord
    ): Promise<HistoryRecord> {
        return this.visit(scope, update) as Promise<HistoryRecord>;
    }
    private async visit(
        scope: HistoryScope,
        update?: (value: HistoryRecord | null) => HistoryRecord
    ): Promise<HistoryRecord | null> {
        if (scope.instanceId !== this.instanceId)
            throw new Error('History profile mismatch');
        const key = historyScopeKey(scope);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const open = indexedDB.open(
                `iptvnator-history-v1:${this.instanceId}`,
                1
            );
            open.onupgradeneeded = () =>
                open.result.createObjectStore('records');
            open.onerror = () => reject(open.error);
            let blocked = false;
            open.onblocked = () => {
                blocked = true;
                reject(new Error('History storage blocked'));
            };
            open.onsuccess = () => {
                if (blocked) return open.result.close();
                open.result.onversionchange = () => open.result.close();
                resolve(open.result);
            };
        });
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(
                    'records',
                    update ? 'readwrite' : 'readonly'
                );
                const store = tx.objectStore('records');
                const read = store.get(key);
                let result: HistoryRecord | null = null;
                let failure: unknown;
                read.onsuccess = () => {
                    try {
                        result = update
                            ? update(read.result ?? null)
                            : (read.result ?? null);
                        if (update && result) {
                            assertHistoryRecord(scope, result);
                            store.put(result, key);
                        }
                    } catch (error) {
                        failure = error;
                        tx.abort();
                    }
                };
                tx.oncomplete = () => resolve(result);
                tx.onerror = tx.onabort = () =>
                    reject(
                        failure ??
                            tx.error ??
                            new Error('History storage failed')
                    );
            });
        } finally {
            db.close();
        }
    }
}
export class ElectronHistoryStore implements HistoryStore {
    constructor(
        private readonly send: (
            request: HistoryLocalRequest
        ) => Promise<unknown>
    ) {}
    read(scope: HistoryScope): Promise<HistoryRecord | null> {
        return this.send({
            operation: 'read',
            instanceId: scope.instanceId,
            scope,
        }) as Promise<HistoryRecord | null>;
    }
    async mutate(
        scope: HistoryScope,
        update: (value: HistoryRecord | null) => HistoryRecord
    ): Promise<HistoryRecord> {
        for (let attempt = 0; attempt < 20; attempt++) {
            const current = await this.read(scope);
            const expected = current ? JSON.stringify(current) : null;
            const value = update(current);
            const result = (await this.send({
                operation: 'commit',
                instanceId: scope.instanceId,
                scope,
                expected,
                value,
            })) as { value?: HistoryRecord; conflict?: boolean };
            if (!result.conflict && result.value) return result.value;
        }
        throw new Error('History storage busy');
    }
}
