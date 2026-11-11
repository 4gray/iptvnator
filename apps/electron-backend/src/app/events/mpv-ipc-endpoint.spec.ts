jest.mock('child_process', () => ({ spawn: jest.fn() }));

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'node:events';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import {
    createMpvIpcEndpoint,
    spawnPlayerWithEndpoint,
} from './mpv-ipc-endpoint';

describe('MPV IPC endpoint', () => {
    it('isolates each launch and removes only its directory on child exit', () => {
        const first = createMpvIpcEndpoint();
        const second = createMpvIpcEndpoint();
        if (!first || !second)
            throw new Error('Synthetic IPC endpoint unavailable');
        try {
            expect(first.path).not.toBe(second.path);
            if (process.platform === 'win32') {
                expect(first.path).toMatch(/^\\\\\.\\pipe\\iptvnator-mpv-/);
                return;
            }
            const directory = dirname(first.path);
            expect(statSync(directory).mode & 0o777).toBe(0o700);
            const child = new EventEmitter();
            jest.mocked(spawn).mockReturnValueOnce(child as ChildProcess);
            spawnPlayerWithEndpoint('/synthetic/mpv', [], false, first);
            child.emit('exit', 0);
            expect(existsSync(directory)).toBe(false);
            expect(existsSync(dirname(second.path))).toBe(true);
        } finally {
            first.dispose();
            second.dispose();
        }
    });

    it('releases the allocated directory when spawning throws', () => {
        const endpoint = createMpvIpcEndpoint();
        if (!endpoint) throw new Error('Synthetic IPC endpoint unavailable');
        try {
            jest.mocked(spawn).mockImplementationOnce(() => {
                throw new Error('Synthetic spawn error');
            });
            expect(() =>
                spawnPlayerWithEndpoint('/synthetic/mpv', [], false, endpoint)
            ).toThrow('Synthetic spawn error');
            if (process.platform !== 'win32')
                expect(existsSync(dirname(endpoint.path))).toBe(false);
        } finally {
            endpoint.dispose();
        }
    });
});
