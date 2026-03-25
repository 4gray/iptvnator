import { Injectable, signal } from '@angular/core';

export type CollectionScope = 'playlist' | 'all';

const STORAGE_PREFIX = 'collection-scope-';

@Injectable({ providedIn: 'root' })
export class ScopeToggleService {
    private readonly scopes = new Map<string, ReturnType<typeof signal<CollectionScope>>>();

    getScope(viewKey: string): ReturnType<typeof signal<CollectionScope>> {
        if (!this.scopes.has(viewKey)) {
            const persisted = this.readFromStorage(viewKey);
            this.scopes.set(viewKey, signal<CollectionScope>(persisted));
        }
        return this.scopes.get(viewKey)!;
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
