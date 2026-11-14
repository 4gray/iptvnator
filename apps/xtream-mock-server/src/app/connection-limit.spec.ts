import type { Request, Response } from 'express';
import {
    activeConnections,
    CONNECTION_WINDOW_MS,
    refuseOverConnectionLimit,
    resetConnectionLimits,
} from './connection-limit.js';
import { getScenario } from './scenarios.js';

function request(user: string, streamId: number): Request {
    return {
        params: { username: user, password: user, streamId: String(streamId) },
    } as unknown as Request;
}

function response() {
    const sent: { status?: number; body?: string } = {};
    const res = {
        status(code: number) {
            sent.status = code;
            return res;
        },
        type() {
            return res;
        },
        send(body: string) {
            sent.body = body;
            return res;
        },
    };
    return { res: res as unknown as Response, sent };
}

describe('Xtream mock connection limit', () => {
    beforeEach(() => resetConnectionLimits());

    it('defines a one-connection account and leaves the default unlimited', () => {
        expect(getScenario('limit', 'limit').connectionLimit).toBe(1);
        expect(getScenario('user1', 'pass1').connectionLimit).toBeUndefined();
    });

    it('refuses a second concurrent stream and lets the first reconnect', () => {
        const first = response();
        const second = response();
        const again = response();

        expect(
            refuseOverConnectionLimit(request('limit', 1), first.res, 0)
        ).toBe(false);
        expect(
            refuseOverConnectionLimit(request('limit', 2), second.res, 1_000)
        ).toBe(true);
        expect(second.sent).toEqual({
            status: 403,
            body: 'Maximum number of connections reached',
        });
        expect(
            refuseOverConnectionLimit(request('limit', 1), again.res, 2_000)
        ).toBe(false);
        expect(activeConnections('limit', 'limit', 2_000)).toBe(1);
    });

    it('frees the slot once the stream stops being requested', () => {
        refuseOverConnectionLimit(request('limit', 1), response().res, 0);

        expect(
            refuseOverConnectionLimit(
                request('limit', 2),
                response().res,
                CONNECTION_WINDOW_MS + 1
            )
        ).toBe(false);
    });

    it('frees the slot on a scoped reset', () => {
        refuseOverConnectionLimit(request('limit', 1), response().res, 0);
        resetConnectionLimits('limit', 'limit');

        expect(
            refuseOverConnectionLimit(request('limit', 2), response().res, 10)
        ).toBe(false);
    });

    it('never refuses or counts an account without a limit', () => {
        for (const id of [1, 2, 3]) {
            expect(
                refuseOverConnectionLimit(
                    {
                        params: {
                            username: 'user1',
                            password: 'pass1',
                            streamId: String(id),
                        },
                    } as unknown as Request,
                    response().res,
                    0
                )
            ).toBe(false);
        }
        expect(activeConnections('user1', 'user1', 0)).toBe(0);
    });
});
