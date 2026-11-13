import {
    type PlaybackDiagnostic,
    PlaybackDiagnosticCode,
} from '@iptvnator/playback/util';

/** What the source's playlist allows, when the provider reports it. */
export interface MultiviewConnectionBudget {
    readonly playlistName: string;
    readonly maxConnections: number;
    readonly activeConnections: number;
}

export interface MultiviewErrorCopy {
    readonly titleKey: string;
    readonly causeKey: string;
    readonly params: Readonly<Record<string, string | number>>;
}

const FORMAT_CODES: ReadonlySet<string> = new Set([
    PlaybackDiagnosticCode.UnsupportedContainer,
    PlaybackDiagnosticCode.UnsupportedCodec,
    PlaybackDiagnosticCode.MediaDecodeError,
    PlaybackDiagnosticCode.DrmOrEncryption,
]);

const NETWORK_CODES: ReadonlySet<string> = new Set([
    PlaybackDiagnosticCode.NetworkError,
    PlaybackDiagnosticCode.BrowserAccessError,
]);

/**
 * Plain-language title and one sentence of cause for a failed tile
 * (spec 9.6). A provider whose budget is spent is named outright (spec 12);
 * otherwise the cause follows the playback diagnostic.
 */
export function multiviewErrorCopy(
    diagnostic: PlaybackDiagnostic | null,
    budget: MultiviewConnectionBudget | null = null
): MultiviewErrorCopy {
    if (budget && budget.activeConnections >= budget.maxConnections) {
        return {
            titleKey: 'PLAYER.MULTIVIEW.ERROR_LIMIT_TITLE',
            causeKey: 'PLAYER.MULTIVIEW.ERROR_LIMIT_CAUSE',
            params: {
                playlist: budget.playlistName,
                max: budget.maxConnections,
            },
        };
    }
    const code = diagnostic?.code ?? '';
    return {
        titleKey: 'PLAYER.MULTIVIEW.ERROR_TITLE',
        causeKey: NETWORK_CODES.has(code)
            ? 'PLAYER.MULTIVIEW.ERROR_NETWORK_CAUSE'
            : FORMAT_CODES.has(code)
              ? 'PLAYER.MULTIVIEW.ERROR_FORMAT_CAUSE'
              : 'PLAYER.MULTIVIEW.ERROR_GENERIC_CAUSE',
        params: {},
    };
}
