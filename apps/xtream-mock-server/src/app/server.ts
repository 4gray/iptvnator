import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import cors from 'cors';
import express, {
    type NextFunction,
    type Request,
    type Response,
} from 'express';
import { installLiveFormatFixture } from './live-format-fixture.js';
import { resetAll } from './data-store.js';
import { renderMarketingAssetSvg } from './generators/marketing.generator.js';
import { installPerformanceControlRoutes } from './performance-control-routes.js';
import {
    type PerformanceControlState,
    XtreamPerformanceController,
} from './performance-control.js';
import { dispatchAction } from './routes/dispatch.js';
import { getScenario, type ScenarioConfig } from './scenarios.js';
import {
    LOCAL_MEDIA_EPISODE_DOWNLOAD_OPTIONS,
    LOCAL_MEDIA_MOVIE_DOWNLOAD_OPTIONS,
    streamSlowSeriesDownload,
} from './slow-series-download.js';

export { createXtreamMockServerShutdown } from './server-lifecycle.js';

export interface XtreamMockServerOptions {
    readonly control?: {
        readonly enabled: boolean;
        readonly token: string;
    };
    readonly host: string;
    readonly port: number;
}

export interface XtreamMockApplication extends express.Express {
    shutdown(): PerformanceControlState | null;
}

const M3U_FIXTURE = `#EXTM3U
#EXTINF:0 tvg-id="1" tvg-logo="http://channel.icons.url/img/1.png" group-title="News", Channel 1
https://example.channels/path-to-file/1.m3u8
#EXTINF:0 tvg-id="2" tvg-logo="http://channel.icons.url/img/2.png" group-title="News", Positive News TV
https://example.channels/path-to-file/2.m3u8
#EXTINF:0 tvg-id="3" tvg-logo="http://channel.icons.url/img/3.png" group-title="Sport", Sport TVX
https://example.channels/path-to-file/3.m3u8
#EXTINF:0 tvg-id="4" tvg-logo="http://channel.icons.url/img/4.png" group-title="Kids", HappyKids TV
https://example.channels/path-to-file/4.m3u8
`;
const HLS_STUB = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const DEFAULT_PORT = 3211;
// Loopback by default: the fixtures serve fabricated but unauthenticated
// content, so they should not be reachable from other hosts unless a dev
// explicitly opts in with HOST=0.0.0.0 (e.g. to point a phone or STB at them).
const DEFAULT_NORMAL_HOST = '127.0.0.1';
const DEFAULT_CONTROL_HOST = '127.0.0.1';
const PERFORMANCE_USERNAME = 'performance';
const PERFORMANCE_PASSWORD = 'performance';
const marketingRasterAssetRoot = join(
    process.cwd(),
    'apps/xtream-mock-server/public/marketing'
);

export function createXtreamMockApp(
    options: XtreamMockServerOptions
): XtreamMockApplication {
    validateServerOptions(options);
    const app = express() as XtreamMockApplication;
    const controlEnabled = options.control?.enabled === true;
    const controller = controlEnabled
        ? new XtreamPerformanceController()
        : undefined;
    app.shutdown = () => controller?.shutdown() ?? null;

    if (controller && options.control) {
        installPerformanceControlRoutes(app, controller, options.control.token);
    }
    app.use(cors());
    app.use(express.json());

    app.get('/health', (_request, response) => {
        response.json({
            status: 'ok',
            server: 'xtream-mock-server',
            port: options.port,
        });
    });
    app.post('/reset', (_request, response) => {
        if (controlEnabled) {
            response
                .status(410)
                .json({ error: 'use-performance-control-reset' });
            return;
        }
        resetAll();
        response.json({ status: 'reset' });
    });
    app.get('/playlist.m3u', (_request, response) => {
        if (controlEnabled) {
            response.status(410).json({ error: 'performance-media-disabled' });
            return;
        }
        response
            .type('audio/x-mpegurl')
            .set('Cache-Control', 'no-store')
            .send(M3U_FIXTURE);
    });
    installMarketingAssetRoute(app);

    app.get('/player_api.php', (request, response, next) => {
        dispatchWithControl(controller, request, response, next, 'direct', () =>
            dispatchAction(request, response)
        );
    });
    if (!controlEnabled) installLiveFormatFixture(app);
    installStreamRoutes(app, controlEnabled);
    app.get('/xtream', (request, response, next) => {
        dispatchWithControl(controller, request, response, next, 'proxy', () =>
            dispatchProxyAction(request, response)
        );
    });

    return app;
}

export function parseXtreamMockServerEnvironment(
    environment: NodeJS.ProcessEnv
): XtreamMockServerOptions {
    const rawPort = environment['PORT'] ?? String(DEFAULT_PORT);
    if (!/^\d+$/.test(rawPort)) {
        throw new Error('Xtream mock port must be an integer');
    }
    const port = Number(rawPort);
    const controlEnabled = environment['IPTVNATOR_XTREAM_MOCK_CONTROL'] === '1';
    const host =
        environment['HOST'] ??
        (controlEnabled ? DEFAULT_CONTROL_HOST : DEFAULT_NORMAL_HOST);
    const token = environment['IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN'] ?? '';
    const options: XtreamMockServerOptions = {
        ...(controlEnabled
            ? { control: { enabled: true, token } as const }
            : {}),
        host,
        port,
    };
    validateServerOptions(options);
    return options;
}

function validateServerOptions(options: XtreamMockServerOptions): void {
    if (
        !Number.isInteger(options.port) ||
        options.port < 0 ||
        options.port > 65_535
    ) {
        throw new Error('Xtream mock port must be in 0..65535');
    }
    if (!options.host) throw new Error('Xtream mock host is required');
    if (!options.control?.enabled) return;
    if (options.control.token.trim().length === 0) {
        throw new Error('Xtream performance control token is required');
    }
    if (options.host !== '127.0.0.1' && options.host !== '::1') {
        throw new Error(
            'Xtream performance control requires a loopback bind host'
        );
    }
}

function dispatchWithControl(
    controller: XtreamPerformanceController | undefined,
    request: Request,
    response: Response,
    next: NextFunction,
    transport: 'direct' | 'proxy',
    dispatch: () => void
): void {
    if (!controller) {
        dispatch();
        return;
    }
    void controller
        .intercept(request, response, transport, dispatch)
        .catch(next);
}

function dispatchProxyAction(request: Request, response: Response): void {
    const { url, action, ...rest } = request.query as Record<string, string>;
    void url;
    const syntheticRequest = {
        query: { action, ...rest },
        headers: request.headers,
        params: {},
    } as unknown as Request;
    let payload: unknown;
    let statusCode = 200;
    const syntheticResponse = {
        json(data: unknown) {
            payload = data;
            return this;
        },
        status(code: number) {
            statusCode = code;
            return this;
        },
    } as unknown as Response;

    dispatchAction(syntheticRequest, syntheticResponse);
    if (statusCode !== 200) {
        response.status(statusCode).json({ error: payload });
        return;
    }
    response.json({ payload, action });
}

function installMarketingAssetRoute(app: express.Express): void {
    app.get('/assets/marketing/:kind/:slug', (request, response) => {
        const kind = request.params['kind'] as
            'backdrop' | 'episode' | 'logo' | 'poster' | 'season';
        const slug = request.params['slug'] ?? '';
        const size =
            typeof request.query['size'] === 'string'
                ? request.query['size']
                : undefined;
        if (
            !['backdrop', 'episode', 'logo', 'poster', 'season'].includes(kind)
        ) {
            response.status(404).send('Unknown marketing asset kind');
            return;
        }
        const rasterSlug = slug.replace(/\.(svg|png)$/i, '');
        const rasterPath = join(
            marketingRasterAssetRoot,
            kind,
            `${rasterSlug}.png`
        );
        if (existsSync(rasterPath)) {
            response
                .type('image/png')
                .set('Cache-Control', 'public, max-age=3600')
                .send(readFileSync(rasterPath));
            return;
        }
        response
            .type('image/svg+xml')
            .set('Cache-Control', 'public, max-age=3600')
            .send(renderMarketingAssetSvg(kind, slug, size));
    });
}

function installStreamRoutes(
    app: express.Express,
    controlEnabled: boolean
): void {
    const streamResponse = (request: Request, response: Response) => {
        if (isPerformanceMediaRequest(request, controlEnabled)) {
            response.status(410).json({ error: 'performance-media-disabled' });
            return;
        }
        response.redirect(HLS_STUB);
    };
    const movieResponse = (request: Request, response: Response) => {
        if (isPerformanceMediaRequest(request, controlEnabled)) {
            response.status(410).json({ error: 'performance-media-disabled' });
            return;
        }
        if (downloadStreamFixtureOf(request) === 'local-media') {
            streamSlowSeriesDownload(
                request,
                response,
                LOCAL_MEDIA_MOVIE_DOWNLOAD_OPTIONS
            );
            return;
        }
        response.redirect(HLS_STUB);
    };
    const seriesResponse = (request: Request, response: Response) => {
        if (isPerformanceMediaRequest(request, controlEnabled)) {
            response.status(410).json({ error: 'performance-media-disabled' });
            return;
        }
        const fixture = downloadStreamFixtureOf(request);
        if (fixture === 'slow-series') {
            streamSlowSeriesDownload(request, response);
            return;
        }
        if (fixture === 'local-media') {
            streamSlowSeriesDownload(
                request,
                response,
                LOCAL_MEDIA_EPISODE_DOWNLOAD_OPTIONS
            );
            return;
        }
        response.redirect(HLS_STUB);
    };
    app.get('/live/:username/:password/:streamId.m3u8', streamResponse);
    app.get('/live/:username/:password/:streamId.ts', streamResponse);
    app.get('/movie/:username/:password/:streamId.:ext', movieResponse);
    app.get('/series/:username/:password/:streamId.:ext', seriesResponse);
    app.all(
        '/timeshift/:username/:password/:duration/:start/:streamId.ts',
        streamResponse
    );
    app.all('/streaming/timeshift.php', streamResponse);
}

function downloadStreamFixtureOf(
    request: Request
): ScenarioConfig['downloadStreamFixture'] {
    const username = String(request.params['username'] ?? '');
    const password = String(request.params['password'] ?? '');
    return getScenario(username, password).downloadStreamFixture;
}

function isPerformanceMediaRequest(
    request: Request,
    controlEnabled: boolean
): boolean {
    if (!controlEnabled) return false;
    const username =
        request.params['username'] ?? request.query['username'] ?? '';
    const password =
        request.params['password'] ?? request.query['password'] ?? '';
    return (
        username === PERFORMANCE_USERNAME && password === PERFORMANCE_PASSWORD
    );
}
