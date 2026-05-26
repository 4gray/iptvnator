import { getStalkerPlaybackContextHeaders } from '../services/stalker-playback-context.service';

export interface EffectiveExternalPlaybackRequest {
    mergedHeaders: Record<string, string>;
    effectiveOrigin?: string;
    effectiveReferer?: string;
    effectiveUserAgent?: string;
    headerFields: string[];
}

export function buildHttpHeaderFields(
    origin?: string,
    headers?: Record<string, string>
): string[] {
    const fields: string[] = [];
    const normalizedHeaders = headers ?? {};

    if (
        origin &&
        normalizedHeaders['Origin'] === undefined &&
        normalizedHeaders['origin'] === undefined
    ) {
        fields.push(`Origin: ${origin}`);
    }

    Object.entries(normalizedHeaders).forEach(([name, value]) => {
        if (!name || value === undefined || value === null) return;
        const trimmedValue = String(value).trim();
        if (!trimmedValue) return;
        fields.push(`${name}: ${trimmedValue}`);
    });

    return fields;
}

export function isStalkerDirectStreamProfile(
    headers: Record<string, string>
): boolean {
    const icyMetaData = headers['Icy-MetaData'] ?? headers['icy-metadata'];
    const userAgent = headers['User-Agent'] ?? headers['user-agent'];

    return (
        String(icyMetaData).trim() === '1' &&
        String(userAgent).trim().toLowerCase() === 'ksplayer'
    );
}

export function resolveEffectiveExternalPlaybackRequest(options: {
    url: string;
    userAgent?: string;
    referer?: string;
    origin?: string;
    headers?: Record<string, string>;
}): EffectiveExternalPlaybackRequest {
    const fallbackHeaders = getStalkerPlaybackContextHeaders(options.url) ?? {};
    const mergedHeaders = isStalkerDirectStreamProfile(fallbackHeaders)
        ? fallbackHeaders
        : {
              ...fallbackHeaders,
              ...(options.headers ?? {}),
          };
    const effectiveOrigin =
        options.origin ??
        mergedHeaders['Origin'] ??
        mergedHeaders['origin'] ??
        undefined;
    const effectiveReferer =
        options.referer ??
        mergedHeaders['Referer'] ??
        mergedHeaders['referer'] ??
        undefined;
    const effectiveUserAgent =
        options.userAgent ??
        mergedHeaders['User-Agent'] ??
        mergedHeaders['user-agent'] ??
        undefined;

    return {
        mergedHeaders,
        effectiveOrigin,
        effectiveReferer,
        effectiveUserAgent,
        headerFields: buildHttpHeaderFields(effectiveOrigin, mergedHeaders),
    };
}
