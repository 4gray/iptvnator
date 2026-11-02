import type { Request, Response } from 'express';
import { extractMac } from '../request-mac.js';

/** Long lazy VOD series; always enforce the server's 14-row page size. */
export function handleIssue1844Pagination(
    req: Request,
    res: Response
): boolean {
    if (extractMac(req).toLowerCase() !== '00:1a:79:18:44:02') return false;
    const q = req.query;
    const action = String(q['action']);
    const page = Math.max(1, Number(q['p']) || 1);
    const list = (data: unknown[]) =>
        res.json({
            js: {
                data: data.slice((page - 1) * 14, page * 14),
                total_items: data.length,
                max_page_items: 14,
                cur_page: page,
                total_pages: Math.ceil(data.length / 14),
            },
        });
    if (action === 'get_categories') {
        res.json({
            js: [{ id: '2001', title: 'Fixture shows', alias: 'fixture' }],
        });
    } else if (action === 'get_ordered_list') {
        if (q['type'] !== 'vod') list([]);
        else if (q['episode_id']) {
            const id = String(q['episode_id']);
            list([
                {
                    id: String(Number(id) + 900000),
                    video_id: '30',
                    series_id: id,
                    is_file: true,
                    cmd: `/media/file_${Number(id) + 900000}.mpg`,
                },
            ]);
        } else if (q['season_id']) {
            list(
                Array.from({ length: 58 }, (_, index) => ({
                    id: String(Number(q['season_id']) * 1000 + 58 - index),
                    video_id: '30',
                    season_id: String(q['season_id']),
                    series_number: 58 - index,
                    name: `Episode ${58 - index}`,
                    is_episode: true,
                }))
            );
        } else if (q['movie_id']) {
            list(
                Array.from({ length: 20 }, (_, index) => ({
                    id: String(301 + index),
                    video_id: '30',
                    season_number: String(index + 1),
                    name: `Season ${index + 1}`,
                    is_season: true,
                }))
            );
        } else {
            list([
                {
                    id: '30',
                    name: 'Fixture Paginated',
                    category_id: '2001',
                    is_series: 1,
                    is_movie: true,
                    has_files: 1,
                    cmd: '/media/30.mpg',
                },
            ]);
        }
    } else if (action === 'create_link') {
        const fileId = /file_(\d+)\.mpg/.exec(String(q['cmd']))?.[1];
        const episodeId = Number(fileId) - 900000;
        res.json({
            js: {
                cmd: `http://${req.headers.host}/stream/issue1844/30-${Math.floor(episodeId / 1000)}/${episodeId % 1000}.mp4`,
                error: '',
            },
        });
    } else return false;
    return true;
}
