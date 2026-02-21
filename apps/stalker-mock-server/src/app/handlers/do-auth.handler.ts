import { Request, Response } from 'express';

/**
 * Stalker do_auth — returns user profile / account info.
 */
export function handleDoAuth(req: Request, res: Response): void {
    res.json({
        js: {
            id: '1',
            name: 'Mock User',
            login: 'mockuser',
            password: '',
            status: 'active',
            tariff_expired_date: '2099-12-31',
            phone: '',
            ls: '0',
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            blocked: '0',
            acc_enabled: '1',
            max_connections: '1',
            active_connections: '0',
        },
    });
}
