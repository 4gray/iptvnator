import { Channel, foldSearchText } from '@iptvnator/shared/interfaces';
import { M3uSeries, applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';

/**
 * The shape the shared grid renders. Kept structural rather than imported:
 * the grid's own item interface is not exported, and it carries an index
 * signature precisely so callers can supply their own row shape.
 *
 * One card type serves both sections. A movie card carries the channel URL
 * it plays; a series card carries the numeric id its detail route opens.
 * Exactly one of the two is set, and the component reads whichever its kind
 * put there.
 */
// A type alias rather than an interface: the shared grid's item type has an
// index signature, and TypeScript grants an implicit one to aliases but not
// to interfaces — an interface here fails to assign with no obvious reason.
export type M3uCatalogCard = {
    readonly id: string;
    readonly name: string;
    readonly title: string;
    readonly poster_url?: string;
    /** Movie cards only. */
    readonly channelUrl?: string;
    /** Series cards only. */
    readonly seriesId?: number;
};

/**
 * An M3U row has no artwork field of its own — the grid reads `poster_url`,
 * the playlist provides `tvg-logo`. For a film that logo IS the poster; when
 * it is missing the grid falls back to its own placeholder, which is why
 * nothing is invented here.
 *
 * The displayed title honours the country-prefix setting, so a catalog
 * built from a playlist that writes `TR:DUNE - 2021` reads as the film
 * rather than as a tagged channel.
 */
export function toM3uCatalogCard(
    channel: Channel,
    stripPrefix: boolean
): M3uCatalogCard {
    const name = applyChannelNameStrip(channel.name, stripPrefix);

    return {
        // The row's own id, not its URL: two imported rows can legitimately
        // share a stream URL, and keying on it would file both cards under
        // one group and open whichever row happened to be found first.
        // Cards are never persisted, so per-session identity is enough, and
        // the URL remains the fallback for rows the parser gave no id.
        id: channel.id || channel.url,
        name,
        title: name,
        poster_url: channel.tvg?.logo || undefined,
        channelUrl: channel.url,
    };
}

/**
 * A series card shows the show, not one of its episodes.
 *
 * The title already has the language tag removed by the aggregator, so the
 * country-prefix setting does not apply a second time here — with one
 * exception, `disambiguate`.
 *
 * The aggregator keeps `TR:SHOW` and `DE:SHOW` apart on purpose: they are
 * two dubs, and merging them would interleave two audio languages inside
 * one season. Dropping the tag from the card then produced two cards with
 * the same name, the same poster and no way to tell which audio a click
 * would get. So the tag is restored only where the catalog proves it is
 * needed, and the common case — one show, one card — stays clean.
 *
 * Remakes need no such treatment: they are separated by a stated year, and
 * that year is part of the title the provider wrote, so the two cards
 * already read differently.
 */
export function toM3uSeriesCard(
    series: M3uSeries<Channel>,
    disambiguate = false
): M3uCatalogCard {
    const tag = disambiguate ? series.languageTag : null;
    const name = tag ? `${series.title} (${tag})` : series.title;

    return {
        id: `series:${series.id}`,
        name,
        title: name,
        poster_url: series.posterUrl ?? undefined,
        seriesId: series.id,
    };
}

/**
 * The folded titles more than one series in this catalog answers to.
 *
 * Folded rather than compared raw, because a provider writing `Modern
 * Family` in one group and `MODERN FAMILY` in another still produces two
 * indistinguishable cards.
 */
export function duplicateM3uSeriesTitles(
    series: readonly M3uSeries<Channel>[]
): ReadonlySet<string> {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const entry of series) {
        const key = foldSearchText(entry.title);
        if (seen.has(key)) {
            duplicates.add(key);
        } else {
            seen.add(key);
        }
    }

    return duplicates;
}
