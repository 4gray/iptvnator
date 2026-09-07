import type {
    PlaybackDiagnostic,
    PlaybackDrmSystem,
} from '@iptvnator/playback/util';
import type { PlaybackDiagnosticDetail } from './playback-diagnostic-view.util';

const DRM_LABELS: Record<PlaybackDrmSystem, string> = {
    widevine: 'Widevine',
    playready: 'PlayReady',
    clearkey: 'ClearKey',
    fairplay: 'FairPlay',
};

const STAGE_KEYS: Readonly<Record<string, string>> = {
    manifest: 'MANIFEST',
    playlist: 'PLAYLIST',
    level: 'PLAYLIST',
    segment: 'SEGMENT',
    key: 'KEY',
    license: 'LICENSE',
    media: 'MEDIA',
    loader: 'LOADER',
    demux: 'DEMUX',
    'media-source': 'MEDIA',
};

export function getDiagnosticEvidenceDetails(
    issue: PlaybackDiagnostic
): PlaybackDiagnosticDetail[] {
    const stage =
        issue.shaka?.stage ??
        issue.hls?.stage ??
        issue.mpegTs?.stage ??
        issue.vhs?.stage;
    const stageKey = stage ? STAGE_KEYS[stage] : undefined;
    const drm = (issue.drmSystems ?? [])
        .map((system) => DRM_LABELS[system])
        .filter(Boolean);
    return [
        ...(stage && stageKey
            ? [
                  {
                      labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_STAGE',
                      value: stage,
                      valueKey: `PLAYBACK_DIAGNOSTICS.STAGE_${stageKey}`,
                  },
              ]
            : []),
        ...(drm.length
            ? [
                  {
                      labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_DRM_SYSTEMS',
                      value: drm.join(', '),
                  },
              ]
            : []),
    ];
}
