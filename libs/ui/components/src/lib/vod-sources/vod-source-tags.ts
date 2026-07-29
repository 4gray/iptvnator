import {
    VodSourceDescriptor,
    VodSourceField,
    VodSourcePortalType,
} from '@iptvnator/shared/interfaces';

/**
 * Presentation helpers for the VOD multi-source row.
 *
 * The whole feature rests on one rule: never present a guess as a fact. These
 * helpers are the single place that turns a `VodSourceDescriptor` into tags, so
 * the honesty rules cannot drift between the three surfaces that render rows
 * (details popover, in-player popover, playback error screen).
 */

export type VodSourceTagTone = 'neutral' | 'ok' | 'warn' | 'bad';

export interface VodSourceRowTag {
    /** Stable identity for `@for` tracking; also the tag's semantic slot. */
    id: string;
    tone: VodSourceTagTone;
    /** A provider value, rendered verbatim — never translated. */
    text?: string;
    /** Translation key, used for app copy such as probe outcomes. */
    labelKey?: string;
    /** `~` marks a value that was guessed from the title rather than stated. */
    prefix?: string;
    /** Trailing detail such as `· 0.4s`. */
    suffix?: string;
    /** Material Symbol rendered before the label. */
    icon?: string;
    /** Renders an inline spinner instead of an icon. */
    spinner?: boolean;
}

const PORTAL_TYPE_LABELS: Record<VodSourcePortalType, string> = {
    xtream: 'Xtream',
    stalker: 'Stalker',
    m3u: 'M3U',
};

export const VOD_SOURCE_TAG_KEYS = {
    probeOk: 'PORTALS.MULTI_SOURCE.PROBE_OK',
    probeFail: 'PORTALS.MULTI_SOURCE.PROBE_FAIL',
    probeChecking: 'PORTALS.MULTI_SOURCE.PROBE_CHECKING',
    matchByTitle: 'PORTALS.MULTI_SOURCE.MATCH_BY_TITLE',
} as const;

/**
 * `400` becomes `0.4s`. Returns `undefined` for anything that is not a usable
 * measurement, so the caller renders no latency rather than `NaNs`.
 */
export function formatProbeLatency(latencyMs?: number): string | undefined {
    if (
        typeof latencyMs !== 'number' ||
        !Number.isFinite(latencyMs) ||
        latencyMs < 0
    ) {
        return undefined;
    }

    return `${(latencyMs / 1000).toFixed(1)}s`;
}

/**
 * `api` and `probe` values are facts and render as plain tags. A `parsed` value
 * is a regex guess, so it is prefixed with `~` and carries the warn colour. An
 * absent field renders nothing at all — the row offers the check chip instead.
 */
function fieldTag(
    id: string,
    field: VodSourceField | undefined
): VodSourceRowTag | null {
    if (!field) {
        return null;
    }

    const isGuess = field.provenance === 'parsed';

    return {
        id,
        tone: isGuess ? 'warn' : 'neutral',
        text: field.value,
        prefix: isGuess ? '~' : undefined,
    };
}

/**
 * `idle` and `unknown` both mean "not checked". Neither may ever be shown as
 * offline, so both produce no probe tag and let the check chip take the slot.
 */
function probeTag(source: VodSourceDescriptor): VodSourceRowTag | null {
    const { status, latencyMs } = source.probe;

    if (status === 'probing') {
        return {
            id: 'probe',
            tone: 'neutral',
            labelKey: VOD_SOURCE_TAG_KEYS.probeChecking,
            spinner: true,
        };
    }

    if (status === 'ok') {
        const latency = formatProbeLatency(latencyMs);
        return {
            id: 'probe',
            tone: 'ok',
            icon: 'check',
            labelKey: VOD_SOURCE_TAG_KEYS.probeOk,
            suffix: latency ? `· ${latency}` : undefined,
        };
    }

    if (status === 'fail') {
        return {
            id: 'probe',
            tone: 'bad',
            icon: 'close',
            labelKey: VOD_SOURCE_TAG_KEYS.probeFail,
        };
    }

    return null;
}

/**
 * A fuzzy match is a guess about *which movie this is*, so it is flagged with
 * the same `~` language as guessed metadata, and shows the year when known
 * because that is what lets the user disambiguate.
 */
function matchTag(source: VodSourceDescriptor): VodSourceRowTag | null {
    if (source.matchConfidence !== 'fuzzy') {
        return null;
    }

    return {
        id: 'match',
        tone: 'warn',
        prefix: '~',
        labelKey: VOD_SOURCE_TAG_KEYS.matchByTitle,
        suffix: source.year ? `· ${source.year}` : undefined,
    };
}

/**
 * Fixed order: portal type → quality → codec → container → audio → probe.
 * The fuzzy-match flag sits just before the probe status so the trailing slot
 * stays the availability one across every row.
 */
export function buildVodSourceTags(
    source: VodSourceDescriptor
): VodSourceRowTag[] {
    const tags: (VodSourceRowTag | null)[] = [
        {
            id: 'portal',
            tone: 'neutral',
            text: PORTAL_TYPE_LABELS[source.portalType] ?? source.portalType,
        },
        fieldTag('quality', source.quality),
        fieldTag('codec', source.codec),
        fieldTag('container', source.container),
        fieldTag('audio', source.audio),
        matchTag(source),
        probeTag(source),
    ];

    return tags.filter((tag): tag is VodSourceRowTag => tag !== null);
}

/**
 * The check chip is offered whenever something is unknown — either the stream
 * was never probed, or a metadata field is missing. It is deliberately a single
 * chip rather than one per gap: the user asks once, and the check fills in what
 * it can. While a probe is in flight the chip stands down for the spinner tag.
 */
export function sourceNeedsCheck(source: VodSourceDescriptor): boolean {
    const status = source.probe.status;

    if (status === 'probing') {
        return false;
    }

    const isUnchecked = status === 'idle' || status === 'unknown';
    const hasMissingMetadata =
        !source.quality || !source.codec || !source.container || !source.audio;

    return isUnchecked || hasMissingMetadata;
}

/** Portals have no logos, so the row falls back to a two-letter monogram. */
export function sourceMonogram(playlistName: string): string {
    const trimmed = (playlistName ?? '').trim();

    if (!trimmed) {
        return '?';
    }

    return [...trimmed].slice(0, 2).join('').toUpperCase();
}
