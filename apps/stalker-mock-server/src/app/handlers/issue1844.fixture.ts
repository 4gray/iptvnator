import type { Request, Response } from 'express';
import { extractMac } from '../request-mac.js';

// Research fixture, not a proposed production fix. Protocol reference:
// iptvhakr/stalker_portal@72deceee1e32ea00cf33ecf2376b80902ab11134
// server/lib/vod.class.php: getOrderedList/getEpisodesList/getFilesList/createLink.
// Episode and file primary keys belong to independent tables. File 101 is
// legitimately owned by show B, while episode 101 belongs to show A.
export function handleIssue1844(req: Request, res: Response): boolean {
    if (extractMac(req).toLowerCase() !== '00:1a:79:18:44:01') return false;
    const q = req.query;
    const action = String(q['action']);
    const shows = [
        { id: '10', name: 'Fixture Alpha', category_id: '2001' },
        { id: '20', name: 'Fixture Beta', category_id: '2001' },
    ].map((show) => ({
        ...show,
        is_series: 1,
        is_movie: true,
        has_files: 1,
        cmd: `/media/${show.id}.mpg`,
        year: '2020',
    }));
    const episodes = [
        { id: '101', video_id: '10', season_id: '11', series_number: '1' },
        { id: '102', video_id: '10', season_id: '11', series_number: '2' },
        { id: '201', video_id: '20', season_id: '21', series_number: '1' },
        { id: '202', video_id: '20', season_id: '21', series_number: '2' },
    ].map((episode) => ({
        ...episode,
        name: `Episode ${episode.series_number}`,
        is_episode: true,
        series: ['1', '2'],
    }));
    const files = [
        { id: '201', video_id: '10', series_id: '101' },
        { id: '202', video_id: '10', series_id: '102' },
        { id: '101', video_id: '20', series_id: '201' },
        { id: '102', video_id: '20', series_id: '202' },
    ].map((file) => ({
        ...file,
        is_file: true,
        name: 'English / SD',
        cmd: `/media/file_${file.id}.mpg`,
    }));
    const list = (data: unknown[]) =>
        res.json({
            js: {
                data,
                total_items: data.length,
                max_page_items: 14,
                cur_page: 1,
                total_pages: 1,
            },
        });
    if (action === 'get_categories') {
        res.json({
            js: [{ id: '2001', title: 'Fixture shows', alias: 'fixture' }],
        });
    } else if (action === 'get_ordered_list') {
        if (q['type'] !== 'vod') list([]);
        else if (q['episode_id'])
            list(
                files.filter(
                    (f) =>
                        f.video_id === q['movie_id'] &&
                        f.series_id === q['episode_id']
                )
            );
        else if (q['season_id'])
            list(episodes.filter((e) => e.season_id === q['season_id']));
        else if (q['movie_id'])
            list([
                {
                    id: q['movie_id'] === '10' ? '11' : '21',
                    video_id: q['movie_id'],
                    season_number: '1',
                    name: 'Season 1',
                    is_season: true,
                },
            ]);
        else
            list(
                shows.filter((s) =>
                    s.name
                        .toLowerCase()
                        .includes(String(q['search'] ?? '').toLowerCase())
                )
            );
    } else if (action === 'create_link') {
        const requestedId = /\/media\/file_(\d+)\.mpg/.exec(
            String(q['cmd'])
        )?.[1];
        let file = files.find((f) => f.id === requestedId);
        if (file && q['series']) {
            const originalSeriesId = file.series_id;
            const originalEpisode = episodes.find(
                (e) => e.id === originalSeriesId
            );
            const episode = episodes.find(
                (e) =>
                    e.season_id === originalEpisode?.season_id &&
                    e.series_number === String(q['series'])
            );
            file = files.find((f) => f.series_id === episode?.id);
        }
        const origin = `http://${req.headers.host}`;
        const episode = episodes.find((e) => e.id === file?.series_id);
        res.json({
            js:
                file && episode
                    ? {
                          cmd: `${origin}/stream/issue1844/${file.video_id}/${episode.series_number}.mp4`,
                          error: '',
                          cmd_received: q['cmd'],
                          file_id: file.id,
                      }
                    : { error: 'file_not_found' },
        });
    } else return false;
    return true;
}
