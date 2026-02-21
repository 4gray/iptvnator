import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';

export function handleGetAccountInfo(req: Request, res: Response): void {
    const { username = '', password = '' } = req.query as Record<string, string>;
    const data = getPortalData(username, password);
    const { scenario } = data;

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
            timezone: 'UTC',
            timestamp_now: Math.floor(Date.now() / 1000),
            time_now: new Date().toISOString().replace('T', ' ').replace('.000Z', ''),
        },
    });
}
