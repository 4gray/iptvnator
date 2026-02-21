import { Router, Request, Response } from 'express';
import dispatchPortalAction from './dispatch.js';

const router = Router();

/**
 * Main Stalker API dispatcher.
 * All requests arrive as GET /portal.php?action=<action>&...
 */
router.get('/', (req: Request, res: Response) => {
    dispatchPortalAction(req, res);
});

export default router;
