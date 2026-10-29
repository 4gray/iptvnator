import { readFileSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { safeStorage } from 'electron';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import type { SourceServerConnection } from '@iptvnator/shared/interfaces';

interface StoredConnection extends SourceServerConnection {
    encryptedToken?: string;
}
const filename = () => join(getIptvnatorDataRoot(), 'source-server.json');

export function readSourceServerConfig(): StoredConnection | null {
    try {
        const value = JSON.parse(
            readFileSync(filename(), 'utf8')
        ) as StoredConnection;
        if (
            typeof value?.apiUrl !== 'string' ||
            typeof value.instanceId !== 'string' ||
            !value.instanceId
        )
            throw new Error('SOURCE_SYNC.INCOMPATIBLE');
        const url = new URL(value.apiUrl);
        if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        )
            throw new Error('SOURCE_SYNC.INCOMPATIBLE');
        return value;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new Error('SOURCE_SYNC.INCOMPATIBLE');
    }
}

export function activateSourceServerProfile(): void {
    try {
        const config = readSourceServerConfig();
        if (!config) {
            delete process.env.IPTVNATOR_SOURCE_PROFILE;
            return;
        }
        process.env.IPTVNATOR_SOURCE_PROFILE = createHash('sha256')
            .update(config.instanceId)
            .digest('hex');
    } catch {
        // Keep both the standalone database and previous server projections closed.
        // The renderer opens recovery settings against this disposable profile.
        process.env.IPTVNATOR_SOURCE_PROFILE = createHash('sha256')
            .update('iptvnator:source-config-recovery')
            .digest('hex');
    }
}

let sessionToken: string | undefined;
export function sourceServerToken(config: StoredConnection): string {
    if (sessionToken !== undefined) return sessionToken;
    if (!config.encryptedToken) return '';
    try {
        return safeStorage.decryptString(
            Buffer.from(config.encryptedToken, 'base64')
        );
    } catch {
        throw new Error('SOURCE_SYNC.LOCKED');
    }
}

export function saveSourceServerConfig(
    config: SourceServerConnection,
    token: string
): boolean {
    // Linux basic_text does not provide OS-protected encryption.
    const protectedStorage =
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== 'linux' ||
            safeStorage.getSelectedStorageBackend() !== 'basic_text');
    const encryptedToken =
        token && protectedStorage
            ? safeStorage.encryptString(token).toString('base64')
            : undefined;
    const temporary = `${filename()}.${randomUUID()}.tmp`;
    try {
        writeFileSync(
            temporary,
            JSON.stringify({
                ...config,
                ...(encryptedToken ? { encryptedToken } : {}),
            }),
            { mode: 0o600, flag: 'wx', flush: true }
        );
        renameSync(temporary, filename());
    } finally {
        try {
            unlinkSync(temporary);
        } catch {
            /* Renamed or never created. */
        }
    }
    sessionToken = token;
    return !token || protectedStorage;
}

export function clearSourceServerConfig(): void {
    try {
        unlinkSync(filename());
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw new Error('SOURCE_SYNC.REQUEST_FAILED');
    }
    sessionToken = undefined;
    delete process.env.IPTVNATOR_SOURCE_PROFILE;
}
