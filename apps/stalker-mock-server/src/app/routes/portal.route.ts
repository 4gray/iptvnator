import { Router, Request, Response } from 'express';
import dispatchPortalAction from './dispatch.js';

/**
 * Main Stalker API dispatcher.
 *
 * Two endpoints are served with the same actions but different strictness:
 * `/portal.php` (reseller-panel alias, tolerant) and
 * `/stalker_portal/server/load.php` (canonical Ministra path, enforces the
 * Bearer token exactly like the real middleware).
 */
export function createPortalRouter(enforceAuth: boolean): Router {
    const router = Router();

    router.get('/', (req: Request, res: Response) => {
        dispatchPortalAction(req, res, { enforceAuth });
    });

    return router;
}

export default createPortalRouter(false);
