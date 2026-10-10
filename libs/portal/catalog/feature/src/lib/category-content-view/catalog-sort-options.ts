import { PortalCatalogSortMode } from '@iptvnator/portal/shared/util';

/** A content sort choice of the refine menu and its active-sort chip. */
export interface CatalogSortOption {
    readonly mode: PortalCatalogSortMode;
    /** The menu row, and after "Sort: " the chip's accessible name. */
    readonly labelKey: string;
    /**
     * The chip's visible text: short in every locale, so the chip shows it
     * whole at any pane width.
     */
    readonly chipLabelKey: string;
    /** Offered only by providers that sort by rating. */
    readonly byRating: boolean;
}

export const CATALOG_SORT_OPTIONS: readonly CatalogSortOption[] = [
    {
        mode: 'date-desc',
        labelKey: 'WORKSPACE.SORT_DATE_DESC',
        chipLabelKey: 'WORKSPACE.SORT_CHIP.NEWEST',
        byRating: false,
    },
    {
        mode: 'date-asc',
        labelKey: 'WORKSPACE.SORT_DATE_ASC',
        chipLabelKey: 'WORKSPACE.SORT_CHIP.OLDEST',
        byRating: false,
    },
    {
        mode: 'name-asc',
        labelKey: 'WORKSPACE.SORT_NAME_ASC',
        chipLabelKey: 'WORKSPACE.SORT_NAME_ASC',
        byRating: false,
    },
    {
        mode: 'name-desc',
        labelKey: 'WORKSPACE.SORT_NAME_DESC',
        chipLabelKey: 'WORKSPACE.SORT_NAME_DESC',
        byRating: false,
    },
    {
        mode: 'rating-desc',
        labelKey: 'WORKSPACE.SORT_TOP_RATED',
        chipLabelKey: 'WORKSPACE.SORT_CHIP.TOP_RATED',
        byRating: true,
    },
    {
        mode: 'rating-asc',
        labelKey: 'WORKSPACE.SORT_LOWEST_RATED',
        chipLabelKey: 'WORKSPACE.SORT_CHIP.LOWEST_RATED',
        byRating: true,
    },
];

const UNKNOWN_SORT_LABEL_KEY = 'WORKSPACE.SORT_CUSTOM';

/** Label keys of the active sort; a mode outside the menu reads as custom. */
export function catalogSortLabels(mode: PortalCatalogSortMode | null): {
    labelKey: string;
    chipLabelKey: string;
} {
    return (
        CATALOG_SORT_OPTIONS.find((option) => option.mode === mode) ?? {
            labelKey: UNKNOWN_SORT_LABEL_KEY,
            chipLabelKey: UNKNOWN_SORT_LABEL_KEY,
        }
    );
}
