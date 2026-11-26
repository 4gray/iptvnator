import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';

export const hostedDataDir = () =>
    join(getIptvnatorDataRoot(), 'hosted-server');

export function hostedAccessCode(): string {
    const dir = hostedDataDir();
    const filename = join(dir, 'access-code');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        writeFileSync(filename, randomBytes(10).toString('hex'), {
            flag: 'wx',
            mode: 0o600,
            flush: true,
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const token = readFileSync(filename, 'utf8');
    if (!/^[a-f0-9]{20}$/.test(token))
        throw new Error('Invalid hosted access code');
    return token;
}

export function hostedWorkerPaths() {
    const root = app.getAppPath();
    return app.isPackaged
        ? {
              entry: join(root, 'hosted-backend/main.cjs'),
              assets: join(root, 'hosted-pwa'),
          }
        : {
              entry: join(root, '../web-backend/main.cjs'),
              assets: join(root, '../hosted-pwa/browser'),
          };
}
