import { Injectable, signal } from '@angular/core';
import {
    SourcesFilter,
    SourcesStatusFilter,
    SourcesTypeFilter,
} from './source-list';

export const SOURCES_VIEW_STORAGE_KEY = 'sources:view:v1';

const TYPES: readonly SourcesTypeFilter[] = ['all', 'm3u', 'xtream', 'stalker'];
const STATUSES: readonly SourcesStatusFilter[] = ['all', 'ok', 'bad'];
const DEFAULT_FILTER: SourcesFilter = { type: 'all', status: 'all' };

function readFilter(): SourcesFilter {
    try {
        const raw = localStorage.getItem(SOURCES_VIEW_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<SourcesFilter>) : {};
        return {
            type: TYPES.includes(parsed.type as SourcesTypeFilter)
                ? (parsed.type as SourcesTypeFilter)
                : 'all',
            status: STATUSES.includes(parsed.status as SourcesStatusFilter)
                ? (parsed.status as SourcesStatusFilter)
                : 'all',
        };
    } catch {
        return { ...DEFAULT_FILTER };
    }
}

/**
 * The Sources page's type and status filters, kept across restarts. The two
 * combine (AND); each side-list group counts within the other's choice.
 */
@Injectable({ providedIn: 'root' })
export class SourcesViewStateService {
    private readonly state = signal<SourcesFilter>(readFilter());
    readonly filter = this.state.asReadonly();

    setType(type: SourcesTypeFilter): void {
        this.write({ ...this.state(), type });
    }

    setStatus(status: SourcesStatusFilter): void {
        this.write({ ...this.state(), status });
    }

    reset(): void {
        this.write({ ...DEFAULT_FILTER });
    }

    private write(filter: SourcesFilter): void {
        this.state.set(filter);
        try {
            localStorage.setItem(
                SOURCES_VIEW_STORAGE_KEY,
                JSON.stringify(filter)
            );
        } catch {
            // Filters still apply for this session.
        }
    }
}
