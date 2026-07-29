/**
 * VOD multi-source: the same movie found across several imported playlists.
 *
 * The central rule of this feature is that the UI must never present a guess
 * as a fact. Every metadata field therefore carries WHERE its value came from,
 * and consumers branch on that provenance instead of on the value alone.
 */

/**
 * Where a metadata value came from, in descending order of trust.
 *
 * - `api`    the provider stated it (Xtream `get_vod_info`) — a fact
 * - `parsed` inferred from the title/filename by regex — a guess
 * - `probe`  observed by contacting the stream — a fact
 *
 * v1 only ever produces `probe` for reachability and latency: reading real
 * codecs would need ffprobe, which this app does not ship.
 */
export type VodSourceProvenance = 'api' | 'parsed' | 'probe';

/**
 * A metadata value tagged with its origin. Absent (`undefined`) means "we do
 * not know" — which the UI renders as no tag at all, never as a blank or a
 * placeholder value.
 */
export interface VodSourceField<T = string> {
    value: T;
    provenance: VodSourceProvenance;
}

/** How confidently this source was matched to the movie being viewed. */
export type VodSourceMatchConfidence = 'exact' | 'fuzzy';

/** How the whole source list was matched — drives the popover header text. */
export type VodSourceMatchKind = 'tmdb' | 'title-year';

export type VodSourcePortalType = 'xtream' | 'stalker' | 'm3u';

/** Outcome of an on-demand availability probe. */
export type VodSourceProbeStatus =
    | 'idle'
    | 'probing'
    /** Reachable: HEAD (or the Range-GET fallback) returned a success status */
    | 'ok'
    /** Contacted and refused: a definite non-success HTTP status */
    | 'fail'
    /**
     * Could not be checked — request blocked by policy, timed out, or the
     * runtime has no probe capability. Deliberately distinct from `fail`: an
     * unchecked source must never be displayed as offline.
     */
    | 'unknown';

/**
 * Playback headers a playlist requires, carried into the probe.
 *
 * A panel configured to demand its own User-Agent, Referer or Origin answers
 * 401/403 without them, and calling a stream that plays fine "unavailable" is
 * exactly the confident lie this feature refuses to tell.
 */
export interface StreamProbeHeaders {
    userAgent?: string | null;
    referer?: string | null;
    origin?: string | null;
}

export interface VodSourceProbeResult {
    status: VodSourceProbeStatus;
    /** HTTP status when one was actually received; 0 when none was. */
    httpStatus?: number;
    /** Round-trip time in milliseconds, when the request completed. */
    latencyMs?: number;
    /** ISO timestamp of the check, for the "checked yesterday" tag. */
    probedAt?: string;
}

/**
 * A raw discovery hit, exactly as the database returns it.
 *
 * Deliberately narrow: it is what the `content` table can prove, and nothing
 * more. Notably it carries no container, codec or audio, because those columns
 * do not exist — learning them costs a live request to the foreign portal.
 */
export interface VodSourceCandidateRow {
    playlistId: string;
    playlistName: string;
    categoryId: number;
    xtreamId: number;
    title: string;
    posterUrl: string | null;
    matchConfidence: VodSourceMatchConfidence;
    year: number | null;
}

/**
 * A candidate source as it comes out of discovery: enough to render a row and
 * to resolve a stream URL later, but NOT yet playable. Resolving the URL costs
 * a live request against the foreign playlist, so it is deferred until the
 * user actually asks for this source.
 */
export interface VodSourceCandidate {
    /** Stable within a session: `${playlistId}:${portalType}:${contentId}` */
    id: string;
    playlistId: string;
    playlistName: string;
    portalType: VodSourcePortalType;
    /** Provider-side id of the item (Xtream `stream_id`). */
    contentId: number;
    /** The provider's own title, unnormalized — shown for fuzzy matches. */
    rawTitle: string;
    matchConfidence: VodSourceMatchConfidence;
    /** Release year when known, for disambiguating fuzzy matches. */
    year?: number | null;
    posterUrl?: string | null;

    quality?: VodSourceField;
    codec?: VodSourceField;
    container?: VodSourceField;
    /**
     * The audio track as a LABEL, whatever kind the source could supply: a
     * dub marker guessed from the title, or the codec the provider stated.
     * Display only — the two are not comparable with each other.
     */
    audio?: VodSourceField;
    /**
     * The spoken language, when the provider names one.
     *
     * Kept apart from `audio` because that field holds a codec whenever the
     * fact came from the API, and a codec says nothing about which dub this
     * is: AAC and AC3 can carry the same language, and two AC3 tracks can
     * carry different ones. This is the only field allowed to answer "would
     * the dub change".
     */
    audioLanguage?: VodSourceField;

    /** ISO timestamp of the last failed playback attempt, if any. */
    lastFailedAt?: string;
}

/**
 * A candidate plus the live session state the UI needs to render it.
 */
export interface VodSourceDescriptor extends VodSourceCandidate {
    isActive: boolean;
    isPinned: boolean;
    /** Already attempted this session — failover must not retry it. */
    isTried: boolean;
    probe: VodSourceProbeResult;
}

/**
 * A user's per-movie choice of preferred source.
 *
 * Keyed by `matchKey` (see `vod-source-match-key.util.ts`) rather than by a
 * provider id, because the whole point is that this movie exists under
 * different ids in different portals.
 */
export interface VodSourcePin {
    matchKey: string;
    playlistId: string;
    contentId: number;
    portalType: VodSourcePortalType;
    updatedAt?: string;
}
