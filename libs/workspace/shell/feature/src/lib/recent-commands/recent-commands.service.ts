import { Injectable, computed, inject, signal } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { firstValueFrom } from 'rxjs';
import { STORE_KEY } from '@iptvnator/shared/interfaces';

export interface RecentCommandEntry {
    id: string;
    usedAt: number;
}

export const MAX_RECENT_COMMANDS = 5;

@Injectable({ providedIn: 'root' })
export class RecentCommandsService {
    private readonly storage = inject(StorageMap);
    private readonly _entries = signal<readonly RecentCommandEntry[]>([]);

    readonly entries = computed(() => this._entries());

    constructor() {
        void this.loadFromStorage();
    }

    record(id: string): void {
        if (!id) return;

        const next = [
            { id, usedAt: Date.now() },
            ...this._entries().filter((entry) => entry.id !== id),
        ].slice(0, MAX_RECENT_COMMANDS);

        this._entries.set(next);
        void this.persist(next);
    }

    prune(predicate: (id: string) => boolean): void {
        const current = this._entries();
        const filtered = current.filter((entry) => predicate(entry.id));

        if (filtered.length === current.length) {
            return;
        }

        this._entries.set(filtered);
        void this.persist(filtered);
    }

    private async loadFromStorage(): Promise<void> {
        try {
            const raw = await firstValueFrom(
                this.storage.get(STORE_KEY.RecentCommands)
            );
            const parsed = this.parseStored(raw);
            if (parsed.length > 0) {
                this._entries.set(parsed);
            }
        } catch (error) {
            console.error('Failed to load recent commands:', error);
        }
    }

    private async persist(
        entries: readonly RecentCommandEntry[]
    ): Promise<void> {
        try {
            await firstValueFrom(
                this.storage.set(STORE_KEY.RecentCommands, entries)
            );
        } catch (error) {
            console.error('Failed to persist recent commands:', error);
        }
    }

    private parseStored(raw: unknown): RecentCommandEntry[] {
        if (!Array.isArray(raw)) return [];

        return raw
            .filter(
                (entry): entry is RecentCommandEntry =>
                    !!entry &&
                    typeof entry === 'object' &&
                    typeof (entry as RecentCommandEntry).id === 'string' &&
                    typeof (entry as RecentCommandEntry).usedAt === 'number'
            )
            .slice(0, MAX_RECENT_COMMANDS);
    }
}
