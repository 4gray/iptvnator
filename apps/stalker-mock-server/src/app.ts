import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import { resetAll } from './app/data-store.js';
import dispatchPortalAction from './app/routes/dispatch.js';
import portalRouter from './app/routes/portal.route.js';

export interface StalkerMockAppOptions {
    now?: () => Date;
    log?: (message: string) => void;
}

export function createStalkerMockApp(
    options: StalkerMockAppOptions = {}
): Express {
    const now = options.now ?? (() => new Date());
    const log = options.log ?? console.log;
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.use((req, _res, next) => {
        const action = req.query['action'] ?? '-';
        const mac =
            (req.headers['cookie'] ?? '')
                .split(';')
                .find((cookie) => cookie.trim().startsWith('mac='))
                ?.split('=')[1]
                ?.trim() ??
            (req.query['macAddress'] as string) ??
            'no-mac';
        log(
            `[${now().toISOString()}] ${req.method} ${req.path} action=${action} mac=${mac}`
        );
        next();
    });

    app.use('/portal.php', portalRouter);

    app.get('/stalker', (req: Request, res: Response) => {
        const query = req.query as Record<string, string>;
        const macAddress = query['macAddress'];
        const rest = Object.fromEntries(
            Object.entries(query).filter(
                ([key]) => key !== 'macAddress' && key !== 'url'
            )
        );
        const mac = macAddress ?? '00:1a:79:00:00:01';
        const syntheticReq = {
            query: rest,
            headers: { cookie: `mac=${mac}` },
            params: {},
        } as unknown as Request;

        let captured: unknown;
        const syntheticRes = {
            json: (data: unknown) => {
                captured = data;
            },
        } as unknown as Response;

        dispatchPortalAction(syntheticReq, syntheticRes);
        res.json({ payload: captured });
    });

    app.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok', timestamp: now().toISOString() });
    });

    app.post('/reset', (_req: Request, res: Response) => {
        resetAll();
        res.json({ status: 'reset', timestamp: now().toISOString() });
    });

    return app;
}
