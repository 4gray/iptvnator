import { Channel, VideoPlayer } from '@iptvnator/shared/interfaces';
import {
    m3uEpisodePlayerOverride,
    m3uEpisodeStaysInline,
} from './m3u-episode-player-override.util';

const episode = (url: string, extra: Partial<Channel> = {}) =>
    ({ url, name: 'SHOW S1 E1', raw: '', ...extra }) as unknown as Channel;

describe('m3uEpisodePlayerOverride', () => {
    const dash = episode('http://h.example/series/u/p/1.mpd');
    const keyed = episode('http://h.example/series/u/p/2.mp4', {
        raw: [
            '#KODIPROP:inputstream.adaptive.license_type=clearkey',
            '#KODIPROP:inputstream.adaptive.license_key={"keys":[]}',
        ].join('\n'),
    });
    const plain = episode('http://h.example/series/u/p/3.mp4');

    it('gives DASH and DRM episodes an engine that plays them inline', () => {
        for (const configured of [
            VideoPlayer.MPV,
            VideoPlayer.VLC,
            VideoPlayer.VideoJs,
            VideoPlayer.Html5Player,
            undefined,
        ]) {
            expect(m3uEpisodePlayerOverride(dash, configured)).toBe(
                VideoPlayer.Html5Player
            );
        }
        expect(m3uEpisodePlayerOverride(keyed, VideoPlayer.MPV)).toBe(
            VideoPlayer.Html5Player
        );
    });

    it('keeps ArtPlayer when that is the setting', () => {
        expect(m3uEpisodePlayerOverride(dash, VideoPlayer.ArtPlayer)).toBe(
            VideoPlayer.ArtPlayer
        );
    });

    it('keeps the setting for any other episode', () => {
        expect(m3uEpisodePlayerOverride(plain, VideoPlayer.VideoJs)).toBeNull();
        expect(m3uEpisodePlayerOverride(null, VideoPlayer.MPV)).toBeNull();
        expect(m3uEpisodeStaysInline(plain)).toBe(false);
        expect(m3uEpisodeStaysInline(keyed)).toBe(true);
    });
});
