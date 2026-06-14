import Artplayer from 'artplayer';
import Hls from 'hls.js';

type AudioTrackSelector = {
    html: string | HTMLElement;
    default?: boolean;
};

const AUDIO_TRACK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="white">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
</svg>`;

export function addHlsAudioTrackSettings(
    player: Artplayer,
    hls: Hls
): void {
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        const tracks = hls.audioTracks;
        if (!tracks || tracks.length <= 1) return;

        player.setting.add({
            html: 'Audio',
            icon: AUDIO_TRACK_ICON,
            width: 220,
            tooltip: tracks[hls.audioTrack]?.name || '',
            selector: tracks.map((track, index) => ({
                html: track.name || track.lang || `Track ${index + 1}`,
                default: index === hls.audioTrack,
            })),
            onSelect: function (this: Artplayer, item: AudioTrackSelector) {
                const selectedLabel =
                    typeof item.html === 'string'
                        ? item.html
                        : (item.html.textContent ?? '');
                const selectedIndex = tracks.findIndex(
                    (track, index) =>
                        (track.name || track.lang || `Track ${index + 1}`) ===
                        selectedLabel
                );
                if (selectedIndex >= 0) {
                    hls.audioTrack = selectedIndex;
                }
            },
        });
    });
}
