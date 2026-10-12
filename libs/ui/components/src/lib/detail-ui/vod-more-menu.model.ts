/** One row of the details "…" menu. Labels are i18n keys; hints are literal. */
export interface VodMoreMenuItem {
    readonly id: string;
    readonly labelKey: string;
    readonly labelParams?: Record<string, string | number>;
    /** Right-aligned literal hint: a count, a category, a player name. */
    readonly hint?: string | number | null;
    readonly icon?: string;
    readonly disabled?: boolean;
    readonly testId?: string;
    /** `sources` swaps the panel to the alternative-sources list on select. */
    readonly kind?: 'action' | 'sources';
}

/** A labelled group of rows; groups are separated by a hairline. */
export interface VodMoreMenuSection {
    readonly labelKey?: string | null;
    readonly items: readonly VodMoreMenuItem[];
}
