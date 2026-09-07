import {
    PlaybackRuntimeSupport,
    SHAKA_ERROR_CODE,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';

/** Read evidence only from the engine that owns this diagnostic. */
export function getDiagnosticEvidence(issue: PlaybackDiagnostic) {
    switch (issue.source) {
        case 'shaka':
            return issue.shaka;
        case 'hls':
            return issue.hls;
        case 'vhs':
            return issue.vhs;
        case 'mpegts':
            return issue.mpegTs;
        default:
            return undefined;
    }
}

/** Source DRM declarations alone never select a failure explanation. */
export function getDiagnosticSummaryKey(
    issue: PlaybackDiagnostic
): string | undefined {
    const prefix = 'PLAYBACK_DIAGNOSTICS.';
    if (
        issue.code === 'drm-or-encryption' &&
        issue.runtimeSupport ===
            PlaybackRuntimeSupport.DrmConfigurationUnsupported
    ) {
        return prefix + 'DRM_CONFIGURATION_UNSUPPORTED';
    }
    if (issue.source === 'shaka' && issue.shaka?.category === 'drm') {
        switch (issue.shaka.engineCode) {
            case SHAKA_ERROR_CODE.REQUESTED_KEY_SYSTEM_CONFIG_UNAVAILABLE:
                return prefix + 'DRM_CONFIGURATION_UNAVAILABLE';
            case SHAKA_ERROR_CODE.LICENSE_REQUEST_FAILED:
                return prefix + 'LICENSE_REQUEST_FAILED';
            case SHAKA_ERROR_CODE.LICENSE_RESPONSE_REJECTED:
                return prefix + 'LICENSE_RESPONSE_REJECTED';
            case SHAKA_ERROR_CODE.NO_LICENSE_SERVER_GIVEN:
                return prefix + 'LICENSE_SERVER_MISSING';
        }
    }
    const evidence = getDiagnosticEvidence(issue);
    const status = evidence?.httpStatus ?? issue.httpStatus;
    if (
        issue.code === 'network-error' &&
        evidence?.stage === 'segment' &&
        (status === 401 || status === 403)
    ) {
        return prefix + 'SEGMENT_ACCESS_DENIED';
    }
    if (issue.code === 'network-error' && evidence?.stage === 'license') {
        return prefix + 'LICENSE_REQUEST_FAILED';
    }
    return undefined;
}
