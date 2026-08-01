import { Request, Response } from 'express';
import { markDoAuthCompleted } from '../auth-store.js';
import { extractMac } from '../request-mac.js';

/**
 * Stalker do_auth — the login/password step behind `get_profile` status 2.
 *
 * The real portal never checks a password itself: it proxies the credentials
 * to the operator's billing script and answers a bare boolean. The mock
 * accepts any non-empty pair, records the completion so `get_profile` can
 * stop answering `status: 2` for the login-required scenario, and rejects
 * empty credentials the way a billing script would.
 */
export function handleDoAuth(req: Request, res: Response): void {
    const login = String(req.query['login'] ?? '');
    const password = String(req.query['password'] ?? '');

    if (!login || !password) {
        res.json({ js: false });
        return;
    }

    markDoAuthCompleted(extractMac(req));
    res.json({ js: true });
}
