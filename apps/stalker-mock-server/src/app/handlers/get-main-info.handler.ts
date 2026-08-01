import { Request, Response } from 'express';

/**
 * Stalker `account_info/get_main_info` — subscription facts for the
 * account-info dialog. Uses the nested `js.account_info` envelope that
 * Ministra-style portals answer with (the shape `fetchStalkerExpireDate()`
 * already consumes), plus flat aliases some panels emit alongside it.
 */
export function handleGetMainInfo(req: Request, res: Response): void {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 180);
    const mac = (req.query['mac'] as string) || '00:1A:79:00:00:01';

    res.json({
        js: {
            mac,
            phone: '10042',
            account_info: {
                login: 'mockuser',
                status: 1,
                tariff_plan: 'Mock Premium 180',
                end_date: expiry.toISOString().slice(0, 10),
            },
        },
    });
}
