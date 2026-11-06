export interface StalkerCategoryItem {
    category_id: string;
    category_name: string;
    /**
     * Translation key of an entry the store adds itself — the every-item
     * genre `'*'` ("All categories" / "All radio"). Such an entry keeps an
     * empty `category_name`: a name translated while the list loaded would
     * stay in that language after a runtime language switch, so views
     * translate this key when they render it.
     */
    labelKey?: string;
    /**
     * Ministra "censored" genre flag (adult categories). Portals typically
     * exclude these channels from `get_all_channels`, so censored categories
     * are served via the legacy paged flow and get no count badge.
     */
    censored?: boolean;
    [key: string]: unknown;
}
