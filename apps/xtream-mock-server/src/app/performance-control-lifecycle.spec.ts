import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { XtreamPerformanceController } from './performance-control.js';

jest.mock('@faker-js/faker', () => ({
    faker: { seed: jest.fn() },
}));

describe('Xtream performance controller lifecycle', () => {
    it.each([
        ['observations', 1],
        ['all', 2],
    ] as const)(
        'invalidates an unmatched pre-reset response on %s reset',
        async (mode, expectedEpoch) => {
            const controller = new XtreamPerformanceController();
            const request = createRequest();
            const response = createResponse();

            await controller.intercept(
                request,
                response as unknown as Response,
                'direct',
                () => undefined
            );
            expect(controller.snapshot().ledger).toHaveLength(1);

            controller.reset(mode);

            expect(response.listenerCount('finish')).toBe(0);
            expect(response.listenerCount('close')).toBe(0);
            expect(response.destroyed).toBe(true);

            response.writableFinished = true;
            response.emit('finish');
            response.emit('close');

            expect(controller.snapshot()).toMatchObject({
                epoch: expectedEpoch,
                heldIds: [],
                heldCount: 0,
                occurrences: [],
                ledger: [],
            });
        }
    );
});

function createRequest(): Request {
    return Object.assign(new EventEmitter(), {
        aborted: false,
        query: {
            username: 'performance',
            password: 'performance',
        },
    }) as unknown as Request;
}

function createResponse(): EventEmitter & {
    destroyed: boolean;
    headersSent: boolean;
    writableFinished: boolean;
    destroy(): void;
    json(): unknown;
    status(): unknown;
} {
    const response = Object.assign(new EventEmitter(), {
        destroyed: false,
        headersSent: false,
        writableFinished: false,
        destroy() {
            response.destroyed = true;
            response.emit('close');
        },
        json() {
            return response;
        },
        status() {
            return response;
        },
    });
    return response;
}
