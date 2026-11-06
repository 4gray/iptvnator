import { join } from 'node:path';
import type { Express, Request, Response } from 'express';
/** Three paged lazy-Ministra seasons/files, kept separate from legacy regular fixtures. */
export function handleTvMinistraFixture(req: Request, res: Response): void {
    const movie = String(req.query['movie_id'] ?? '20000');
    const season = String(req.query['season_id'] ?? '');
    const episode = String(req.query['episode_id'] ?? '');
    const page = Math.max(1, Number(req.query['p']) || 1);
    const data = episode
        ? [
              {
                  id: `9${episode}`,
                  is_file: true,
                  video_id: movie,
                  series_id: episode,
                  cmd: `/media/file_9${episode}.mpg`,
              },
          ]
        : season
          ? [1, 2, 3].map((n) => ({
                id: `${season}${n}`,
                is_episode: true,
                series_number: String(n),
                name: `Episode ${n}`,
                description: 'Local TV fixture',
                duration: '30',
            }))
          : [3, 1, 2].map((n) => ({
                id: `${movie}${n}`,
                video_id: movie,
                is_season: true,
                season_number: String(n),
                name: `Season ${n}`,
            }));
    res.json({
        js: {
            data: data.slice((page - 1) * 2, page * 2),
            total_items: data.length,
            max_page_items: 2,
            cur_page: page,
        },
    });
}

export function installTvMinistraMedia(app: Express): void {
    app.get('/stream/tv-video.webm', (_req, res) =>
        res.sendFile(
            join(
                process.cwd(),
                'apps/web-e2e/src/fixtures/playback/episode.webm'
            ),
            { dotfiles: 'allow', headers: { 'Content-Type': 'video/webm' } }
        )
    );
}
