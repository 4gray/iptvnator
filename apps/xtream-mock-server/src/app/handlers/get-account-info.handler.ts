import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';

export function handleGetAccountInfo(req: Request, res: Response): void {
    const { username = '', password = '' } = req.query as Record<string, string>;
    const data = getPortalData(username, password);
    const { scenario } = data;
    const serverClock = scenario.serverClock ?? {
        timezone: 'UTC',
        utcOffsetMinutes: 0,
    };
    const nowSeconds = Math.floor(Date.now() / 1000);
    // A real panel formats `time_now` with `date()` in its own timezone:
    // the same instant as `timestamp_now`, shifted by the panel's offset.
    const timeNow = new Date(
        (nowSeconds + serverClock.utcOffsetMinutes * 60) * 1000
    )
        .toISOString()
        .replace('T', ' ')
        .replace('.000Z', '');

    res.json({
        user_info: {
            username,
            password,
            message: '',
            auth: 1,
            status: scenario.accountStatus,
            exp_date: String(Math.floor(new Date(scenario.expiryDate).getTime() / 1000)),
            is_trial: '0',
            active_cons: '1',
            created_at: String(Math.floor(Date.now() / 1000 - 86400 * 365)),
            max_connections: '2',
            allowed_output_formats: ['m3u8', 'ts', 'rtmp'],
        },
        server_info: {
            url: `http://localhost:3211`,
            port: '3211',
            https_port: '',
            server_protocol: 'http',
            rtmp_port: '',
            timezone: serverClock.timezone,
            timestamp_now: nowSeconds,
            time_now: timeNow,
        },
    });
}
