/**
 * Material Icons ligatures whose meaning must stay the same across the app.
 *
 * The heart means "favourite" everywhere: toggles, rail and command entries,
 * collection headers and empty states. The star means a rating only (TMDB or
 * provider scores, the minimum-rating refinement). Use these keys instead of
 * writing the ligature, so a favourite can never pick up a star again;
 * `pnpm run ui:favorite-glyph:validate` rejects literal star and heart names
 * outside this file.
 *
 * Only glyphs with a product-wide meaning belong here. Ordinary icons keep
 * their literal names.
 */
export const APP_ICONS = {
    /** A favourite item, or the favourites collection. */
    favorite: 'favorite',
    /** A favourite toggle that is off, or an empty favourites state. */
    favoriteOutline: 'favorite_border',
    /** A rating value. */
    rating: 'star',
    /** The rating refinement before a minimum is chosen. */
    ratingOutline: 'star_outline',
    /** "Support the project" (About): a donation, not a favourite. */
    support: 'favorite',
} as const;

export type AppIconKey = keyof typeof APP_ICONS;
export type AppIcon = (typeof APP_ICONS)[AppIconKey];

/** Filled heart when the item is a favourite, outline when it is not. */
export function favoriteIcon(isFavorite: boolean | null | undefined): AppIcon {
    return isFavorite ? APP_ICONS.favorite : APP_ICONS.favoriteOutline;
}
