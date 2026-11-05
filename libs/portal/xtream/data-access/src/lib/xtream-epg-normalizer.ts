import {
    EpgItem,
    parseXtreamServerLocalDateTime,
} from '@iptvnator/shared/interfaces';
/**
 * Raw EPG listing from API (before decoding)
 */
interface RawEpgListing {
    id?: string;
    epg_id?: string;
    title?: string;
    description?: string;
    start?: string;
    end?: string;
    stop?: string;
    start_timestamp?: string;
    stop_timestamp?: string;
    channel_id?: string;
    lang?: string;
    [key: string]: unknown;
}

/**
 * EPG API response
 */
export interface EpgResponse {
    epg_listings?: RawEpgListing[] | Record<string, RawEpgListing>;
}

export class XtreamEpgNormalizer {
    /**
     * Decode base64 unicode string (used for EPG data)
     */
    private decodeBase64Unicode(str: string): string {
        try {
            return decodeURIComponent(
                Array.prototype.map
                    .call(atob(str), (c: string) => {
                        return (
                            '%' +
                            ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                        );
                    })
                    .join('')
            );
        } catch {
            return str;
        }
    }

    private getEpgListings(
        response: EpgResponse | null | undefined
    ): RawEpgListing[] {
        const listings = response?.epg_listings;
        if (!listings) {
            return [];
        }

        if (Array.isArray(listings)) {
            return listings;
        }

        return Object.values(listings);
    }

    normalizeShortEpgItems(
        response: EpgResponse,
        serverTimezone?: string
    ): EpgItem[] {
        return this.getEpgListings(response)
            .map((item, index) => {
                const startTimestamp = this.parseUnixTimestamp(
                    item.start_timestamp
                );
                const stopTimestamp = this.parseUnixTimestamp(
                    item.stop_timestamp
                );
                const normalizedStart =
                    this.toIsoString(startTimestamp) ??
                    this.normalizeDateString(item.start, serverTimezone);
                const normalizedStop =
                    this.toIsoString(stopTimestamp) ??
                    this.normalizeDateString(
                        item.stop ?? item.end,
                        serverTimezone
                    );

                return {
                    id: String(item.id ?? index),
                    epg_id: String(item.epg_id ?? ''),
                    title: this.decodeBase64Unicode(
                        String(item.title ?? '')
                    ).trim(),
                    description: this.decodeBase64Unicode(
                        String(item.description ?? '')
                    ).trim(),
                    lang: String(item.lang ?? ''),
                    start: normalizedStart,
                    end: normalizedStop,
                    stop: normalizedStop,
                    channel_id: String(item.channel_id ?? ''),
                    start_timestamp: String(startTimestamp ?? ''),
                    stop_timestamp: String(stopTimestamp ?? ''),
                } satisfies EpgItem;
            })
            .filter((item) => Boolean(item.start) && Boolean(item.stop))
            .sort(
                (left, right) =>
                    this.getEpgItemTimestampMs(
                        left.start,
                        left.start_timestamp
                    ) -
                    this.getEpgItemTimestampMs(
                        right.start,
                        right.start_timestamp
                    )
            );
    }

    normalizeFullEpgItems(
        response: EpgResponse,
        serverTimezone?: string
    ): EpgItem[] {
        return this.getEpgListings(response)
            .map((item, index) => {
                const startTimestamp = this.parseUnixTimestamp(
                    item.start_timestamp
                );
                const stopTimestamp = this.parseUnixTimestamp(
                    item.stop_timestamp
                );
                const normalizedStart =
                    this.toIsoString(startTimestamp) ??
                    this.normalizeDateString(item.start, serverTimezone);
                const normalizedStop =
                    this.toIsoString(stopTimestamp) ??
                    this.normalizeDateString(
                        item.stop ?? item.end,
                        serverTimezone
                    );

                return {
                    id: String(item.id ?? index),
                    epg_id: String(item.epg_id ?? item.channel_id ?? ''),
                    title: this.decodeBase64Unicode(
                        String(item.title ?? '')
                    ).trim(),
                    description: this.decodeBase64Unicode(
                        String(item.description ?? '')
                    ).trim(),
                    lang: String(item.lang ?? ''),
                    start: normalizedStart,
                    end: normalizedStop,
                    stop: normalizedStop,
                    channel_id: String(item.channel_id ?? ''),
                    start_timestamp: String(startTimestamp ?? ''),
                    stop_timestamp: String(stopTimestamp ?? ''),
                } satisfies EpgItem;
            })
            .filter((item) => Boolean(item.start) && Boolean(item.stop))
            .sort(
                (left, right) =>
                    this.getEpgItemTimestampMs(
                        left.start,
                        left.start_timestamp
                    ) -
                    this.getEpgItemTimestampMs(
                        right.start,
                        right.start_timestamp
                    )
            );
    }

    private parseUnixTimestamp(value: unknown): number | null {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    private toIsoString(timestamp: number | null): string | null {
        return timestamp ? new Date(timestamp * 1000).toISOString() : null;
    }

    /**
     * A panel writes `start`/`end` in its own timezone. With that timezone
     * known the string is converted exactly; without it, `Date.parse` reads
     * it in the viewer's clock — the best remaining guess, and the reason
     * `start_timestamp` is preferred whenever present.
     */
    private normalizeDateString(
        value: unknown,
        serverTimezone?: string
    ): string {
        const rawValue = String(value ?? '').trim();
        if (!rawValue) {
            return '';
        }

        const serverLocal = parseXtreamServerLocalDateTime(
            rawValue,
            serverTimezone
        );
        if (serverLocal !== null) {
            return new Date(serverLocal * 1000).toISOString();
        }

        const parsed = Date.parse(rawValue.replace(' ', 'T'));
        return Number.isFinite(parsed)
            ? new Date(parsed).toISOString()
            : rawValue;
    }

    private getEpgItemTimestampMs(
        isoValue: string,
        unixTimestampValue: string
    ): number {
        const unixTimestamp = this.parseUnixTimestamp(unixTimestampValue);
        if (unixTimestamp) {
            return unixTimestamp * 1000;
        }

        return Date.parse(isoValue);
    }
}
