import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { safeStorage } from 'electron';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import type { SourceServerConnection } from '@iptvnator/shared/interfaces';

interface StoredConnection extends SourceServerConnection {
    encryptedToken?: string;
}
const filename = () => join(getIptvnatorDataRoot(), 'source-server.json');

export function readSourceServerConfig(): StoredConnection | null {
    if (!existsSync(filename())) return null;
    const value = JSON.parse(
        readFileSync(filename(), 'utf8')
    ) as StoredConnection;
    if (!value.apiUrl || !value.instanceId)
        throw new Error('Invalid source server configuration');
    return value;
}

export function activateSourceServerProfile(): void {
    const config = readSourceServerConfig();
    if (config)
        process.env.IPTVNATOR_SOURCE_PROFILE = createHash('sha256')
            .update(config.instanceId)
            .digest('hex');
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
    writeFileSync(
        filename(),
        JSON.stringify({
            ...config,
            ...(encryptedToken ? { encryptedToken } : {}),
        }),
        { mode: 0o600 }
    );
    sessionToken = token;
    return !token || protectedStorage;
}

export function clearSourceServerConfig(): void {
    if (existsSync(filename())) unlinkSync(filename());
    sessionToken = undefined;
}
