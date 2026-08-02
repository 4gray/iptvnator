import { Request, Response } from 'express';
import { checkRequestAuthorization } from '../auth-store.js';
import { handleHandshake } from '../handlers/handshake.handler.js';
import { handleDoAuth } from '../handlers/do-auth.handler.js';
import { handleGetEvents } from '../handlers/get-events.handler.js';
import { handleGetProfile } from '../handlers/get-profile.handler.js';
import { handleGetAllChannels } from '../handlers/get-all-channels.handler.js';
import { handleGetCategories } from '../handlers/get-categories.handler.js';
import { handleGetOrderedList } from '../handlers/get-ordered-list.handler.js';
import { handleGetSeasons } from '../handlers/get-seasons.handler.js';
import { handleCreateLink } from '../handlers/create-link.handler.js';
import { handleFavorites } from '../handlers/favorites.handler.js';
import { handleGetEpgInfo } from '../handlers/get-epg-info.handler.js';
import { handleGetShortEpg } from '../handlers/get-short-epg.handler.js';
import { handleGetGenres } from '../handlers/get-genres.handler.js';
import { handleGetMainInfo } from '../handlers/get-main-info.handler.js';

export interface DispatchOptions {
    /**
     * Whether the endpoint enforces the Bearer token. The canonical
     * `/stalker_portal/server/load.php` path does (like a real portal); the
     * reseller-style `/portal.php` alias does not, which is what most panels in
     * the wild behave like and what the existing e2e suite relies on.
     */
    enforceAuth?: boolean;
}

/**
 * Shared Stalker action dispatcher.
 * Used by the direct portal routes and the /stalker CORS proxy route.
 */
export default function dispatchPortalAction(
    req: Request,
    res: Response,
    options: DispatchOptions = {}
): void {
    const action = req.query['action'] as string;

    const authFailure = checkRequestAuthorization(
        req,
        options.enforceAuth ?? false
    );
    if (authFailure) {
        // The real middleware echoes this as a plain-text body with HTTP 200 —
        // never a 401/403 — because it exits before the JSON envelope is built.
        res.status(200).type('html').send(authFailure);
        return;
    }

    switch (action) {
        case 'handshake':
            handleHandshake(req, res);
            break;
        case 'get_profile':
            handleGetProfile(req, res, {
                // A real portal validates the MAC format by default; the
                // tolerant reseller alias does not.
                enforceMacFormat: options.enforceAuth ?? false,
            });
            break;
        case 'get_events':
            handleGetEvents(req, res);
            break;
        case 'do_auth':
            handleDoAuth(req, res);
            break;
        case 'get_main_info':
            handleGetMainInfo(req, res);
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
        case 'get_all_channels':
            handleGetAllChannels(req, res);
            break;
        case 'create_link':
            handleCreateLink(req, res);
            break;
        case 'favorites':
            handleFavorites(req, res);
            break;
        case 'get_short_epg':
            handleGetShortEpg(req, res);
            break;
        case 'get_epg_info':
            handleGetEpgInfo(req, res);
            break;
        default:
            console.warn(`[portal] Unknown action: ${action}`);
            res.json({ js: { error: `Unknown action: ${action}` } });
    }
}
