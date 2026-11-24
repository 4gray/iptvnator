import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { hostedJsonReply } from './hosted-json-reply';

describe('hosted JSON heartbeats', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('writes on successive intervals and skips blocked or closed responses', () => {
        jest.useFakeTimers();
        const response = Object.assign(new EventEmitter(), {
            headersSent: false,
            destroyed: false,
            writableNeedDrain: false,
            type: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            write: jest.fn(() => {
                response.headersSent = true;
            }),
        });
        hostedJsonReply(response as unknown as Response, true);

        jest.advanceTimersByTime(20_000);
        expect(response.write.mock.calls).toEqual([['\n'], ['\n']]);
        expect(response.set).toHaveBeenCalledTimes(1);

        response.writableNeedDrain = true;
        jest.advanceTimersByTime(10_000);
        response.writableNeedDrain = false;
        response.destroyed = true;
        jest.advanceTimersByTime(10_000);
        expect(response.write).toHaveBeenCalledTimes(2);

        response.emit('close');
        expect(jest.getTimerCount()).toBe(0);
    });
});
