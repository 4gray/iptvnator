import { extname } from 'node:path';
import express, { type Express } from 'express';

export function createHostedWebApp(api: Express, assets: string): Express {
    const app = express();
    app.disable('x-powered-by');
    app.use('/api', api);
    app.use('/api', (_req, res) => res.sendStatus(404));
    app.get('/assets/app-config.js', (_req, res) => {
        res.set('Cache-Control', 'no-store')
            .type('js')
            .send('window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: "/api" };');
    });
    app.use(express.static(assets, { redirect: false }));
    app.get('/{*path}', (req, res, next) => {
        if (extname(req.path) || !req.accepts('html')) return next();
        return res.sendFile('index.html', {
            root: assets,
            headers: { 'Cache-Control': 'no-cache' },
        });
    });
    return app;
}
