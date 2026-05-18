import { Injectable, signal } from '@angular/core';

export type CollectionScope = 'playlist' | 'all';
type CollectionScopeSignal = ReturnType<typeof signal<CollectionScope>>;

const STORAGE_PREFIX = 'collection-scope-';

@Injectable({ providedIn: 'root' })
export class ScopeToggleService {
    private readonly scopes = new Map<string, CollectionScopeSignal>();

    getScope(viewKey: string): CollectionScopeSignal {
        let scope = this.scopes.get(viewKey);
        if (!scope) {
            const persisted = this.readFromStorage(viewKey);
            scope = signal<CollectionScope>(persisted);
            this.scopes.set(viewKey, scope);
        }
        return scope;
    }

    setScope(viewKey: string, value: CollectionScope): void {
        const s = this.getScope(viewKey);
        s.set(value);
        try {
            localStorage.setItem(STORAGE_PREFIX + viewKey, value);
        } catch {
            // storage full or unavailable
        }
    }

    private readFromStorage(viewKey: string): CollectionScope {
        try {
            const stored = localStorage.getItem(STORAGE_PREFIX + viewKey);
            if (stored === 'all' || stored === 'playlist') return stored;
        } catch {
            // ignore
        }
        return 'playlist';
    }
}
