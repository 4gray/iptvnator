import { Request, Response } from 'express';

/**
 * Stalker `account_info/get_main_info` — subscription facts for the
 * account-info dialog. Field names deliberately mirror the loosely
 * standardized panels in the wild (end_date as a date string, tariff_plan,
 * numeric status where 1 = active).
 */
export function handleGetMainInfo(req: Request, res: Response): void {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 180);

    res.json({
        js: {
            mac: (req.query['mac'] as string) || '00:1A:79:00:00:01',
            phone: '10042',
            login: 'mockuser',
            status: 1,
            tariff_plan: 'Mock Premium 180',
            end_date: expiry.toISOString().slice(0, 10),
        },
    });
}
