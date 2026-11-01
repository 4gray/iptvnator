import type { Request, Response } from 'express';
import {
    resetDroppingEpisodes,
    streamDroppingEpisode,
} from './dropping-episode.js';

function attempt(password: string) {
    let finishWrite: (() => void) | undefined;
    const request = {
        params: {
            username: 'synthetic-account',
            password,
            streamId: '80000.mkv',
        },
        get: () => undefined,
    } as unknown as Request;
    const response = {
        set: jest.fn().mockReturnThis(),
        status: jest.fn().mockReturnThis(),
        type: jest.fn().mockReturnThis(),
        write: jest.fn((_body: Buffer, callback: () => void) => {
            finishWrite = callback;
        }),
        end: jest.fn(),
        socket: { destroy: jest.fn() },
    };
    streamDroppingEpisode(request, response as unknown as Response);
    return { response, finishWrite: () => finishWrite?.() };
}

afterEach(() => resetDroppingEpisodes());

test('a cut callback from before reset cannot populate the new account state', () => {
    const old = attempt('owner');
    expect(old.response.write).toHaveBeenCalledTimes(1);
    resetDroppingEpisodes('synthetic-account', 'owner');
    const fresh = attempt('owner');
    expect(fresh.response.write).toHaveBeenCalledTimes(1);
    old.finishWrite();
    const stillFresh = attempt('owner');
    expect(stillFresh.response.status).toHaveBeenCalledWith(200);
    expect(stillFresh.response.write).toHaveBeenCalledTimes(1);
    fresh.finishWrite();
    expect(attempt('owner').response.status).toHaveBeenCalledWith(403);
});

test('account reset and late callbacks preserve another account with the same episode ID', () => {
    const owner = attempt('owner');
    const peer = attempt('peer');
    owner.finishWrite();
    peer.finishWrite();
    resetDroppingEpisodes('synthetic-account', 'owner');
    owner.finishWrite();
    expect(attempt('peer').response.status).toHaveBeenCalledWith(403);
    expect(attempt('owner').response.write).toHaveBeenCalledTimes(1);
    resetDroppingEpisodes();
    expect(attempt('peer').response.write).toHaveBeenCalledTimes(1);
});
