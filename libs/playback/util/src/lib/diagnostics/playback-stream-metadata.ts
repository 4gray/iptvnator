/** Safe, bounded facts about a source; never evidence that it can be played. */
export const PlaybackDrmSystem = {
    Widevine: 'widevine',
    PlayReady: 'playready',
    ClearKey: 'clearkey',
    FairPlay: 'fairplay',
} as const;

export type PlaybackDrmSystem =
    (typeof PlaybackDrmSystem)[keyof typeof PlaybackDrmSystem];

const DRM_SYSTEMS = new Map<string, PlaybackDrmSystem>([
    ['com.widevine.alpha', PlaybackDrmSystem.Widevine],
    [
        'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed',
        PlaybackDrmSystem.Widevine,
    ],
    ['com.microsoft.playready', PlaybackDrmSystem.PlayReady],
    ['com.microsoft.playready.recommendation', PlaybackDrmSystem.PlayReady],
    [
        'urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95',
        PlaybackDrmSystem.PlayReady,
    ],
    ['org.w3.clearkey', PlaybackDrmSystem.ClearKey],
    ['clearkey', PlaybackDrmSystem.ClearKey],
    [
        'urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e',
        PlaybackDrmSystem.ClearKey,
    ],
    ['com.apple.fps', PlaybackDrmSystem.FairPlay],
    ['com.apple.fps.1_0', PlaybackDrmSystem.FairPlay],
    [
        'urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2',
        PlaybackDrmSystem.FairPlay,
    ],
]);

export function getPlaybackDrmSystem(
    value: unknown
): PlaybackDrmSystem | undefined {
    return typeof value === 'string'
        ? DRM_SYSTEMS.get(value.trim().toLowerCase())
        : undefined;
}

export interface PlaybackCodecTrack {
    readonly audioCodec?: unknown;
    readonly videoCodec?: unknown;
}

// Only codec identifiers, never arbitrary provider labels or engine messages.
// Full AV1 has nine suffix fields: https://aomediacodec.github.io/av1-isobmff/#codecsparam
const VIDEO_CODEC =
    /^(?:(?:avc1|avc3)\.[0-9a-f]{6}|(?:hev1|hvc1|hvc2|vp09|vp08)(?:\.[0-9a-fhlm]{1,12}){1,8}|av01(?:\.[0-9mh]{1,12}){1,9}|h264|h265|hevc|vp8|vp9|mpeg2video|mp2v|theora)$/i;
const AUDIO_CODEC =
    /^(?:mp4a\.[0-9a-f]{2}(?:\.\d{1,2})?|aac|ac-?3|ec-?3|eac-?3|dac3|dec3|dts|dtsc|dtse|dtsh|dtsl|opus|vorbis|flac|mp3|mp2)$/i;

export function collectPlaybackCodecs(tracks: readonly unknown[]) {
    const audio = new Set<string>();
    const video = new Set<string>();
    for (const value of tracks.slice(0, 256)) {
        if (!value || typeof value !== 'object') continue;
        const track = value as PlaybackCodecTrack;
        collect(track.audioCodec, AUDIO_CODEC, audio);
        collect(track.videoCodec, VIDEO_CODEC, video);
    }
    return { audioCodecs: [...audio], videoCodecs: [...video] };
}

function collect(value: unknown, pattern: RegExp, target: Set<string>): void {
    if (typeof value !== 'string' || value.length > 256) return;
    for (const token of value.split(',').map((item) => item.trim())) {
        if (target.size < 16 && token.length <= 64 && pattern.test(token)) {
            target.add(token);
        }
    }
}
