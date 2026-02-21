import { Request, Response } from 'express';
import { generateSeasons } from '../data-generator.js';
import { getPortalData } from '../data-store.js';
import { getScenario } from '../scenarios.js';
import { extractMac } from './get-categories.handler.js';

/**
 * Stalker get_ordered_list with type=series for seasons/episodes.
 * When a series item is opened, the frontend requests seasons via
 * get_ordered_list?action=get_ordered_list&type=series&movie_id=<id>
 *
 * This handler is invoked from the main portal router when movie_id is present.
 */
export function handleGetSeasons(req: Request, res: Response): void {
    const mac = extractMac(req);
    const seriesId = req.query['movie_id'] as string;
    const data = getPortalData(mac);
    const scenario = getScenario(mac);

    // Try the precomputed seasons map first
    if (data.seasons.has(seriesId)) {
        res.json({ js: data.seasons.get(seriesId) });
        return;
    }

    // Series id might belong to a VOD item with is_series=1 — generate seasons on demand
    let foundItem: { id: string; name: string; o_name: string; title: string; cmd: string; screenshot_uri: string; cover: string; description: string; actors: string; director: string; year: string; genres_str: string; rating_imdb: string; rating_kinopoisk: string; category_id: string; is_series: 0; has_files: 0 } | undefined;

    for (const items of data.vod.values()) {
        const match = items.find((i) => i.id === seriesId);
        if (match) {
            foundItem = {
                ...match,
                genres_str: match.genres_str ?? match.genre ?? '',
                is_series: 0,
                has_files: 0,
            };
            break;
        }
    }

    if (!foundItem) {
        res.json({ js: [] });
        return;
    }

    const seasons = generateSeasons(
        foundItem,
        scenario.seasonsPerSeries,
        scenario.episodesPerSeason
    );
    data.seasons.set(seriesId, seasons);

    res.json({ js: seasons });
}
