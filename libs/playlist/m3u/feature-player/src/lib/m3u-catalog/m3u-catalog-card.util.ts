import { Channel } from '@iptvnator/shared/interfaces';
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
        // The parser mints a fresh random id on every import, so the URL is
        // the only stable identity a card can carry across a refresh.
        id: channel.url,
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
 * country-prefix setting does not apply a second time here.
 */
export function toM3uSeriesCard(series: M3uSeries<Channel>): M3uCatalogCard {
    return {
        id: `series:${series.id}`,
        name: series.title,
        title: series.title,
        poster_url: series.posterUrl ?? undefined,
        seriesId: series.id,
    };
}
