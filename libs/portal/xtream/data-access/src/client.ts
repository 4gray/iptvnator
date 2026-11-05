import {
    normalizeXtreamServerUrl,
    resolveXtreamPortalStatus,
    resolveXtreamServerTimezone,
} from '@iptvnator/shared/interfaces';
import { XtreamEpgNormalizer } from './lib/xtream-epg-normalizer';
export { resolveXtreamVodPlaybackSource } from './lib/services/xtream-vod-playback-source';
export interface XtreamConnection {
    url: string;
    username?: string;
    password?: string;
}
export type XtreamWireRequest = (
    params: Record<string, string | number>,
    signal: AbortSignal
) => Promise<unknown>;
/** Framework-free wire client. The host chooses and owns its transport. */
export class XtreamClient extends XtreamEpgNormalizer {
    timezone?: string;
    formats: string[] = [];
    constructor(
        readonly connection: XtreamConnection,
        private readonly send: XtreamWireRequest
    ) {
        super();
    }
    async account(signal: AbortSignal) {
        for (const action of ['get_account_info', '', 'get_profile']) {
            let payload: unknown;
            try {
                payload = await this.request(action, {}, signal);
            } catch {
                if (signal.aborted)
                    throw new DOMException('Aborted', 'AbortError');
                continue;
            }
            const result = payload as Parameters<
                typeof resolveXtreamPortalStatus
            >[0] & {
                user_info?: { allowed_output_formats?: string[] };
            };
            if (result?.user_info) {
                if (resolveXtreamPortalStatus(result) !== 'active')
                    throw new Error('Xtream account is inactive or expired.');
                this.timezone = resolveXtreamServerTimezone(
                    (
                        result as unknown as {
                            server_info?: Parameters<
                                typeof resolveXtreamServerTimezone
                            >[0];
                        }
                    ).server_info
                );
                this.formats = result.user_info.allowed_output_formats ?? [];
                return result;
            }
        }
        throw new Error('Xtream did not return account information.');
    }
    request(
        action: string,
        params: Record<string, string | number>,
        signal: AbortSignal
    ) {
        return this.send(
            {
                ...(action ? { action } : {}),
                username: this.connection.username?.trim() ?? '',
                password: this.connection.password?.trim() ?? '',
                ...params,
            },
            signal
        );
    }
    stream(
        kind: 'live' | 'movie' | 'series',
        id: string | number,
        extension: string
    ): string {
        if (
            !Number.isSafeInteger(Number(id)) ||
            Number(id) <= 0 ||
            !/^[a-z0-9]+$/i.test(extension)
        )
            throw new Error(
                'Provider did not supply a complete stream ID and extension.'
            );
        const base = normalizeXtreamServerUrl(this.connection.url);
        return `${base}/${kind}/${encodeURIComponent(this.connection.username?.trim() ?? '')}/${encodeURIComponent(this.connection.password?.trim() ?? '')}/${id}.${extension}`;
    }
    async epg(id: string, signal: AbortSignal) {
        const result = await this.request(
            'get_short_epg',
            { stream_id: id, limit: 12 },
            signal
        );
        return this.normalizeShortEpgItems(
            result as Parameters<
                XtreamEpgNormalizer['normalizeShortEpgItems']
            >[0],
            this.timezone
        );
    }
}

export { xtreamCatalogTimestamp } from './lib/xtream-catalog-date';
