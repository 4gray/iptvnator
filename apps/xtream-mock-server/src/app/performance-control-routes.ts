import { timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express, {
    type ErrorRequestHandler,
    type NextFunction,
    type Request,
    type Response,
} from 'express';
import {
    PERFORMANCE_CONTROL_LIMITS,
    XtreamPerformanceController,
} from './performance-control.js';
import {
    assertSafeRuleId,
    parsePrepareBody,
    parseReleaseBody,
    parseResetBody,
    parseRuleBody,
    PerformanceControlError,
} from './performance-control-validation.js';

const TOKEN_HEADER = 'x-iptvnator-performance-token';

export function installPerformanceControlRoutes(
    app: express.Express,
    controller: XtreamPerformanceController,
    token: string
): void {
    const router = express.Router();
    router.use(authorize(token));
    router.use(cors());
    router.use(
        express.json({
            limit: PERFORMANCE_CONTROL_LIMITS.jsonBytes,
            strict: true,
        })
    );

    router.post('/prepare', (request, response) => {
        executeControl(response, () => {
            parsePrepareBody(request.body);
            response.json(controller.prepare());
        });
    });
    router.post('/reset', (request, response) => {
        executeControl(response, () => {
            const { mode } = parseResetBody(request.body);
            response.json(controller.reset(mode));
        });
    });
    router.post('/barriers', (request, response) => {
        executeControl(response, () => {
            const rule = controller.addRule(
                parseRuleBody('barrier', request.body)
            );
            response.status(201).json(rule);
        });
    });
    router.post('/barriers/:id/release', (request, response) => {
        executeControl(response, () => {
            const id = request.params['id'] ?? '';
            assertSafeRuleId(id);
            parseReleaseBody(request.body);
            if (!controller.releaseBarrier(id)) {
                throw new PerformanceControlError(
                    404,
                    'held-barrier-not-found'
                );
            }
            response.json({ id, released: true });
        });
    });
    router.post('/delays', (request, response) => {
        executeControl(response, () => {
            const rule = controller.addRule(
                parseRuleBody('delay', request.body)
            );
            response.status(201).json(rule);
        });
    });
    router.get('/state', (_request, response) => {
        response.json(controller.snapshot());
    });
    router.use(jsonErrorHandler);
    app.use('/__control', router);
}

function authorize(token: string) {
    const expected = Buffer.from(token, 'utf8');
    return (request: Request, response: Response, next: NextFunction) => {
        const provided = request.get(TOKEN_HEADER);
        if (!provided || !constantTimeEqual(expected, provided)) {
            response.status(401).json({ error: 'unauthorized' });
            return;
        }
        next();
    };
}

function constantTimeEqual(expected: Buffer, provided: string): boolean {
    const candidate = Buffer.from(provided, 'utf8');
    return (
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
    );
}

function executeControl(response: Response, execute: () => void): void {
    try {
        execute();
    } catch (error) {
        if (error instanceof PerformanceControlError) {
            response.status(error.status).json({ error: error.code });
            return;
        }
        response.status(500).json({ error: 'control-internal-error' });
    }
}

const jsonErrorHandler: ErrorRequestHandler = (
    error: Error & { status?: number; type?: string },
    _request,
    response,
    _next
) => {
    void _next;
    const tooLarge = error.status === 413 || error.type === 'entity.too.large';
    response
        .status(tooLarge ? 413 : 400)
        .json({ error: tooLarge ? 'control-json-too-large' : 'invalid-json' });
};
