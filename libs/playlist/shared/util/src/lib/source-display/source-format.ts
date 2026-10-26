import {
    PlaylistMeta,
    resolvePlaylistSourceKind,
    SourceStatus,
} from '@iptvnator/shared/interfaces';
import { SourceDisplayFields, sourceDisplayUrl } from './source-display';

/** `TranslateService.instant` or a test double. */
export type SourceTranslate = (
    key: string,
    params?: Record<string, unknown>
) => string;

export interface SourceFormatContext {
    translate: SourceTranslate;
    /** A BCP 47 locale for `Intl`, e.g. from `normalizeDateLocale`. */
    locale: string;
    now: number;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Provider names are brands, the same in every language. */
const KIND_LABELS = {
    m3u: 'M3U',
    xtream: 'Xtream',
    stalker: 'Stalker',
} as const;

function toDate(value: string | number | undefined | null): Date | null {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const date =
        typeof value === 'number' || /^\d+$/.test(value)
            ? new Date(Number(value))
            : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function dateFormat(
    locale: string,
    options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
    try {
        return new Intl.DateTimeFormat(locale, options);
    } catch {
        return new Intl.DateTimeFormat('en', options);
    }
}

/**
 * A short date in the UI language: day and month, the year only when it is
 * not the current one, and the time when asked for.
 */
export function formatSourceDate(
    value: string | number | undefined | null,
    locale: string,
    now: number,
    withTime = false
): string | null {
    const date = toDate(value);
    if (!date) {
        return null;
    }
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return dateFormat(locale, {
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: 'numeric' }),
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(date);
}

/** "3 days" / "5 hours" in the UI language; null under an hour. */
export function formatSourceDuration(
    since: number,
    locale: string,
    now: number
): string | null {
    const elapsed = now - since;
    const [unit, amount] =
        elapsed >= DAY_MS
            ? (['day', Math.floor(elapsed / DAY_MS)] as const)
            : (['hour', Math.floor(elapsed / HOUR_MS)] as const);
    if (amount < 1) {
        return null;
    }
    // The app's TypeScript lib (es2018) predates unit formatting; every
    // supported runtime has it.
    const options = {
        style: 'unit',
        unit,
        unitDisplay: 'long',
    } as unknown as Intl.NumberFormatOptions;
    try {
        return new Intl.NumberFormat(locale, options).format(amount);
    } catch {
        return new Intl.NumberFormat('en', options).format(amount);
    }
}

export function sourceTypeLabel(
    playlist: Pick<PlaylistMeta, 'macAddress' | 'serverUrl' | 'url'>,
    translate: SourceTranslate
): string {
    const kind = resolvePlaylistSourceKind(playlist);
    if (kind === 'm3u' && !playlist.url) {
        return translate('WORKSPACE.SOURCES.ROW.TYPE_M3U_FILE');
    }
    return KIND_LABELS[kind];
}

export type SourceMetaPartKind =
    'type' | 'channels' | 'added' | 'updated' | 'url';

export interface SourceMetaPart {
    kind: SourceMetaPartKind;
    text: string;
}

export type SourceMetaFields = SourceDisplayFields &
    Partial<Pick<PlaylistMeta, 'count' | 'importDate' | 'updateDate'>>;

/**
 * The meta line, always in this order: type · channels · added · updated ·
 * URL, with empty parts left out. Only M3U playlists know their channel
 * count. The compact switcher row keeps type, channels and updated.
 */
export function sourceMetaParts(
    playlist: SourceMetaFields,
    context: SourceFormatContext,
    compact = false
): SourceMetaPart[] {
    const { translate, locale, now } = context;
    const parts: SourceMetaPart[] = [
        { kind: 'type', text: sourceTypeLabel(playlist, translate) },
    ];
    const isM3u = resolvePlaylistSourceKind(playlist) === 'm3u';
    if (isM3u && (playlist.count ?? 0) > 0) {
        const count = new Intl.NumberFormat(locale).format(playlist.count ?? 0);
        parts.push({
            kind: 'channels',
            text: translate(
                playlist.count === 1
                    ? 'WORKSPACE.SOURCES.ROW.CHANNELS_ONE'
                    : 'HOME.PLAYLISTS.CHANNELS_COUNT',
                { count }
            ),
        });
    }
    const added = compact
        ? null
        : formatSourceDate(playlist.importDate, locale, now);
    if (added) {
        parts.push({
            kind: 'added',
            text: translate('WORKSPACE.SOURCES.ROW.ADDED', { date: added }),
        });
    }
    const updated = formatSourceDate(playlist.updateDate, locale, now, true);
    if (updated) {
        parts.push({
            kind: 'updated',
            text: translate('WORKSPACE.SOURCES.ROW.UPDATED', { date: updated }),
        });
    }
    const url = compact ? null : sourceDisplayUrl(playlist);
    if (url) {
        parts.push({ kind: 'url', text: url });
    }
    return parts;
}

export interface SourceStatusTag {
    label: string;
    tone: 'danger' | 'neutral';
}

/**
 * The tag after the name. A healthy source has none: green is the dot's
 * job. The compact row drops the duration and the "not checked" tag.
 */
export function sourceStatusTag(
    status: SourceStatus | null,
    context: SourceFormatContext,
    compact = false
): SourceStatusTag | null {
    const { translate, locale, now } = context;
    switch (status?.reachability) {
        case 'bad': {
            const duration =
                !compact && status.failingSince !== undefined
                    ? formatSourceDuration(status.failingSince, locale, now)
                    : null;
            return {
                tone: 'danger',
                label: duration
                    ? translate('WORKSPACE.SOURCES.ROW.UNREACHABLE_FOR', {
                          duration,
                      })
                    : translate('WORKSPACE.SOURCES.ROW.UNREACHABLE'),
            };
        }
        case 'expired':
            return {
                tone: 'danger',
                label: translate('WORKSPACE.SOURCES.ROW.EXPIRED'),
            };
        case 'unknown':
            return compact
                ? null
                : {
                      tone: 'neutral',
                      label: translate('SOURCE_HEALTH.REASON.unknown'),
                  };
        default:
            return null;
    }
}
