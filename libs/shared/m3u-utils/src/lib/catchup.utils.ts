import { Channel, EpgProgram } from 'shared-interfaces';

const XMLTV_TIMESTAMP_PATTERN =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{2})(\d{2})$/;

type CatchupSupportMode = 'none' | 'source' | 'shift';

export function getM3uArchiveDays(
    channel: Pick<Channel, 'tvg' | 'timeshift' | 'catchup'> | null | undefined
): number {
    const value = getFirstNonBlankValue(
        channel?.catchup?.days,
        channel?.timeshift,
        channel?.tvg?.rec
    );
    return Math.max(0, Number(value ?? 0) || 0);
}

export function isM3uCatchupPlaybackSupported(
    channel: Channel | null | undefined
): boolean {
    return getM3uCatchupSupportMode(channel) !== 'none';
}

export function resolveM3uCatchupUrl(
    channel: Channel | null | undefined,
    program: Pick<EpgProgram, 'start' | 'startTimestamp'>,
    nowTimestampSeconds = Math.floor(Date.now() / 1000)
): string | null {
    const supportMode = getM3uCatchupSupportMode(channel);
    if (supportMode === 'none') {
        return null;
    }

    const startTimestamp = getEpgProgramTimestampSeconds(
        program.start,
        program.startTimestamp
    );
    if (startTimestamp === null) {
        return null;
    }

    const playbackBaseUrl =
        supportMode === 'source'
            ? channel?.catchup?.source
            : channel?.url;
    if (!playbackBaseUrl?.trim()) {
        return null;
    }

    const normalizedNow =
        Number.isFinite(nowTimestampSeconds) && nowTimestampSeconds > 0
            ? Math.floor(nowTimestampSeconds)
            : Math.floor(Date.now() / 1000);

    return setCatchupQueryParams(playbackBaseUrl, {
        utc: startTimestamp,
        lutc: normalizedNow,
    });
}

function getM3uCatchupSupportMode(
    channel: Channel | null | undefined
): CatchupSupportMode {
    if (getM3uArchiveDays(channel) <= 0) {
        return 'none';
    }

    const catchupSource = channel?.catchup?.source?.trim() ?? '';
    if (isHttpUrl(catchupSource)) {
        return 'source';
    }

    const streamUrl = channel?.url?.trim() ?? '';
    const catchupType = channel?.catchup?.type?.trim().toLowerCase() ?? '';
    if (catchupType === 'shift' && isHttpUrl(streamUrl)) {
        return 'shift';
    }

    if (!catchupType && isHttpUrl(streamUrl)) {
        return 'shift';
    }

    return 'none';
}

function getEpgProgramTimestampSeconds(
    dateValue: string,
    unixTimestampValue?: number | string | null
): number | null {
    const unixTimestamp = Number.parseInt(String(unixTimestampValue ?? ''), 10);
    if (Number.isFinite(unixTimestamp) && unixTimestamp > 0) {
        return unixTimestamp;
    }

    const parsed = Date.parse(dateValue);
    if (Number.isFinite(parsed)) {
        return Math.floor(parsed / 1000);
    }

    const match = dateValue.match(XMLTV_TIMESTAMP_PATTERN);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, offsetHours, offsetMinutes] =
        match;
    const utcMillis = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute)
    );
    const offsetTotalMinutes =
        Number(offsetHours) * 60 +
        Math.sign(Number(offsetHours)) * Number(offsetMinutes);

    return Math.floor((utcMillis - offsetTotalMinutes * 60_000) / 1000);
}

function setCatchupQueryParams(
    rawUrl: string,
    params: Record<'utc' | 'lutc', number>
): string | null {
    try {
        const url = new URL(rawUrl.trim());
        url.searchParams.set('utc', String(params.utc));
        url.searchParams.set('lutc', String(params.lutc));
        return url.toString();
    } catch {
        return null;
    }
}

function isHttpUrl(value: string): boolean {
    if (!value) {
        return false;
    }

    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function getFirstNonBlankValue(
    ...values: Array<string | null | undefined>
): string | undefined {
    return values.find(
        (value): value is string => value != null && value.trim() !== ''
    );
}
