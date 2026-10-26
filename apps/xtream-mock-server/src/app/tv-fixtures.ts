import type { Express } from 'express';
import { join } from 'node:path';
/** Local non-DRM media for TV browser behavior tests; not evidence of native HLS support. */
export function installTvFixtures(app: Express): void {
    app.get('/tv-test-media.webm', (_req, res) =>
        res.sendFile(
            join(
                process.cwd(),
                'apps/web-e2e/src/fixtures/playback/episode.webm'
            ),
            { dotfiles: 'allow', headers: { 'Content-Type': 'video/webm' } }
        )
    );
    app.get('/tv-playlist.m3u', (req, res) => {
        const origin = `${req.protocol}://${req.get('host')}`;
        res.type('audio/x-mpegurl').send(
            `#EXTM3U\n#EXTINF:-1 group-title="News",TV Fixture News\n${origin}/live/tv/tv/1.m3u8\n#EXTINF:-1 group-title="Cinema",TV Fixture Movie\n${origin}/movie/tv/tv/2.mp4\n#EXTINF:-1 group-title="Episodes",Standalone S01E02\n${origin}/series/tv/tv/3.mp4\n`
        );
    });
}
