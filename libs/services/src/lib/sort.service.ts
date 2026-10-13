import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';

export enum SortBy {
    DATE_ADDED = 'date',
    /** Last refresh, falling back to the import date. */
    UPDATED = 'updated',
    NAME = 'name',
    /** Channel count; only M3U playlists store one. */
    CHANNELS = 'channels',
    CUSTOM = 'custom',
}

export enum SortOrder {
    ASC = 'asc',
    DESC = 'desc',
}

export interface SortOptions {
    by: SortBy;
    order: SortOrder;
    /**
     * Lists that know source health put the sources that do not respond
     * first, keeping this order within each part.
     */
    failingFirst?: boolean;
}

const SORT_BY_VALUES = new Set<string>(Object.values(SortBy));

const SORT_OPTIONS_STORAGE_KEY = 'iptvnator-sort-options';

function updatedAt(playlist: PlaylistMeta): number {
    const time = playlist.updateDate ?? new Date(playlist.importDate).getTime();
    return Number.isFinite(time) ? time : 0;
}

@Injectable({
    providedIn: 'root',
})
export class SortService {
    private sortOptions = new BehaviorSubject<SortOptions>(
        this.getSavedSortOptions()
    );

    getSortOptions(): Observable<SortOptions> {
        return this.sortOptions.asObservable();
    }

    setSortOptions(options: SortOptions): void {
        this.sortOptions.next(options);
        this.saveSortOptions(options);
    }

    private getSavedSortOptions(): SortOptions {
        const defaultOptions: SortOptions = {
            by: SortBy.DATE_ADDED,
            order: SortOrder.DESC,
        };

        try {
            const savedOptions = localStorage.getItem(SORT_OPTIONS_STORAGE_KEY);
            if (!savedOptions) {
                return defaultOptions;
            }

            const parsedOptions = JSON.parse(savedOptions) as SortOptions;

            // Validate that the saved options match our expected types
            if (
                SORT_BY_VALUES.has(parsedOptions.by) &&
                (parsedOptions.order === SortOrder.ASC ||
                    parsedOptions.order === SortOrder.DESC)
            ) {
                return {
                    by: parsedOptions.by,
                    order: parsedOptions.order,
                    ...(parsedOptions.failingFirst === true
                        ? { failingFirst: true }
                        : {}),
                };
            }

            return defaultOptions;
        } catch (error) {
            console.error(
                'Error retrieving sort options from localStorage:',
                error
            );
            return defaultOptions;
        }
    }

    private saveSortOptions(options: SortOptions): void {
        try {
            localStorage.setItem(
                SORT_OPTIONS_STORAGE_KEY,
                JSON.stringify(options)
            );
        } catch (error) {
            console.error('Error saving sort options to localStorage:', error);
        }
    }

    /**
     * @param nameOf The name a list shows for a source, for Name order: a
     * list that shows a source by its host must sort it by its host, not by
     * a stored title such as `get.php?username=…`.
     */
    sortPlaylists(
        playlists: PlaylistMeta[],
        options: SortOptions,
        nameOf: (playlist: PlaylistMeta) => string = (playlist) =>
            playlist.title
    ): PlaylistMeta[] {
        const { by, order } = options;

        return [...playlists].sort((a, b) => {
            let comparison = 0;

            if (by === SortBy.NAME) {
                comparison = nameOf(a)
                    .toLowerCase()
                    .localeCompare(nameOf(b).toLowerCase());
            } else if (by === SortBy.DATE_ADDED) {
                const dateA = new Date(a.importDate).getTime();
                const dateB = new Date(b.importDate).getTime();
                comparison = dateA - dateB;
            } else if (by === SortBy.UPDATED) {
                comparison = updatedAt(a) - updatedAt(b);
            } else if (by === SortBy.CHANNELS) {
                comparison = (a.count ?? 0) - (b.count ?? 0);
            } else if (by === SortBy.CUSTOM) {
                // Sort by position field (lower position comes first)
                const posA = a.position ?? Number.MAX_SAFE_INTEGER;
                const posB = b.position ?? Number.MAX_SAFE_INTEGER;
                comparison = posA - posB;
                // Custom sort always uses ASC order
                return comparison;
            }

            return order === SortOrder.ASC ? comparison : -comparison;
        });
    }

    isCustomSort(): boolean {
        return this.sortOptions.getValue().by === SortBy.CUSTOM;
    }
}
