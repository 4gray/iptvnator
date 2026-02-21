import { Request, Response } from 'express';
import { handleHandshake } from '../handlers/handshake.handler.js';
import { handleDoAuth } from '../handlers/do-auth.handler.js';
import { handleGetCategories } from '../handlers/get-categories.handler.js';
import { handleGetOrderedList } from '../handlers/get-ordered-list.handler.js';
import { handleGetSeasons } from '../handlers/get-seasons.handler.js';
import { handleCreateLink } from '../handlers/create-link.handler.js';
import { handleFavorites } from '../handlers/favorites.handler.js';
import { handleGetShortEpg } from '../handlers/get-short-epg.handler.js';
import { handleGetGenres } from '../handlers/get-genres.handler.js';

/**
 * Shared Stalker action dispatcher.
 * Used by both the direct /portal.php route and the /stalker CORS proxy route.
 */
export default function dispatchPortalAction(req: Request, res: Response): void {
    const action = req.query['action'] as string;

    switch (action) {
        case 'handshake':
            handleHandshake(req, res);
            break;
        case 'do_auth':
            handleDoAuth(req, res);
            break;
        case 'get_categories':
        case 'get_genres_vod':
        case 'get_genres_itv':
            handleGetCategories(req, res);
            break;
        case 'get_genres':
            handleGetGenres(req, res);
            break;
        case 'get_ordered_list':
            if (req.query['movie_id']) {
                handleGetSeasons(req, res);
            } else {
                handleGetOrderedList(req, res);
            }
            break;
        case 'create_link':
            handleCreateLink(req, res);
            break;
        case 'favorites':
            handleFavorites(req, res);
            break;
        case 'get_short_epg':
        case 'get_epg_info':
            handleGetShortEpg(req, res);
            break;
        default:
            console.warn(`[portal] Unknown action: ${action}`);
            res.json({ js: { error: `Unknown action: ${action}` } });
    }
}
