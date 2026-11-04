import type { Request, Response } from 'express';
import { extractMac } from '../request-mac.js';

/** A provider's absolute episode list, with no season boundaries. */
export function handleFlatSeriesRange(req: Request, res: Response): boolean {
    if (extractMac(req).toLowerCase() !== '00:1a:79:18:44:03') return false;
    const q = req.query;
    if (q['action'] === 'get_categories') {
        res.json({
            js: [{ id: '2001', title: 'Fixture shows', alias: 'fixture' }],
        });
    } else if (q['action'] === 'get_ordered_list') {
        const data =
            q['type'] === 'vod' && !q['movie_id']
                ? [
                      {
                          id: '900001',
                          name: 'Signal House (1-9 season)',
                          o_name: 'Signal House (1-9 season)',
                          year: '2021',
                          category_id: '2001',
                          cmd: '/media/900001.mpg',
                          series: Array.from(
                              { length: 189 },
                              (_, index) => index + 1
                          ),
                      },
                  ]
                : [];
        res.json({
            js: { data, total_items: data.length, max_page_items: 14 },
        });
    } else if (q['action'] === 'create_link') {
        res.json({
            js: {
                cmd: `http://${req.headers.host}/stream/issue1844/900001/${q['series']}.mp4`,
                error: '',
            },
        });
    } else return false;
    return true;
}
