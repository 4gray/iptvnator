import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PlaylistMeta } from '../shared/playlist-meta.type';

export enum SortBy {
    DATE_ADDED = 'date',
    NAME = 'name',
}

export enum SortOrder {
    ASC = 'asc',
    DESC = 'desc',
}

export interface SortOptions {
    by: SortBy;
    order: SortOrder;
}

const SORT_OPTIONS_STORAGE_KEY = 'iptvnator-sort-options';

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
                (parsedOptions.by === SortBy.DATE_ADDED ||
                    parsedOptions.by === SortBy.NAME) &&
                (parsedOptions.order === SortOrder.ASC ||
                    parsedOptions.order === SortOrder.DESC)
            ) {
                return parsedOptions;
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

    sortPlaylists(
        playlists: PlaylistMeta[],
        options: SortOptions
    ): PlaylistMeta[] {
        const { by, order } = options;

        return [...playlists].sort((a, b) => {
            let comparison = 0;

            if (by === SortBy.NAME) {
                comparison = a.title
                    .toLowerCase()
                    .localeCompare(b.title.toLowerCase());
            } else if (by === SortBy.DATE_ADDED) {
                const dateA = new Date(a.importDate).getTime();
                const dateB = new Date(b.importDate).getTime();
                comparison = dateA - dateB;
            }

            return order === SortOrder.ASC ? comparison : -comparison;
        });
    }
}
