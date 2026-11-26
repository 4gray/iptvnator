import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import express, {
    type Express,
    type RequestHandler,
    type Response,
} from 'express';
import { mountHostedDevicePage } from './hosted-device-page';
import { mountHostedCloudflareDevicePage } from './hosted-cloudflare-device-page';
import { mountHostedTvApprovalPage } from './hosted-tv-approval-page';

export function createHostedWebApp(
    api: Express,
    assets: string,
    access?: RequestHandler
): Express {
    const index = readFileSync(join(assets, 'index.html'), 'utf8');
    const sendIndex = (res: Response) =>
        res
            .set('Cache-Control', res.get('Cache-Control') ?? 'no-cache')
            .type('html')
            .send(index);
    const app = express();
    app.disable('x-powered-by');
    if (access) app.use(access);
    if (access) mountHostedCloudflareDevicePage(app);
    mountHostedDevicePage(app);
    mountHostedTvApprovalPage(app);
    app.use('/api', api);
    app.use('/api', (_req, res) => res.sendStatus(404));
    // Cloudflare handles these at the edge. Never serve the player for an
    // authorization or discovery request that reaches the origin.
    app.use(['/cdn-cgi', '/.well-known'], (_req, res) => res.sendStatus(404));
    app.get('/assets/app-config.js', (_req, res) => {
        res.set('Cache-Control', 'no-store')
            .type('js')
            .send('window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: "/api" };');
    });
    app.get(['/', '/index.html'], (_req, res) => sendIndex(res));
    app.use(express.static(assets, { index: false, redirect: false }));
    app.get('/{*path}', (req, res, next) => {
        if (extname(req.path) || !req.accepts('html')) return next();
        return sendIndex(res);
    });
    return app;
}
