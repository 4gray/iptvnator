import {
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
    readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import {
    activateSourceServerProfile,
    clearSourceServerConfig,
    readSourceServerConfig,
    saveSourceServerConfig,
    sourceServerToken,
} from './source-server-config';

jest.mock('electron', () => ({
    safeStorage: {
        isEncryptionAvailable: jest.fn(() => true),
        getSelectedStorageBackend: jest.fn(() => 'gnome_libsecret'),
        encryptString: jest.fn((value: string) =>
            Buffer.from(`protected:${value}`)
        ),
        decryptString: jest.fn((value: Buffer) =>
            value.toString().slice('protected:'.length)
        ),
    },
}));
jest.mock('@iptvnator/shared/database/path-utils', () => ({
    getIptvnatorDataRoot: jest.fn(),
}));

describe('source-server connection persistence', () => {
    let directory: string;
    const originalProfile = process.env.IPTVNATOR_SOURCE_PROFILE;
    const connection = {
        apiUrl: 'https://nas.test/api',
        instanceId: 'instance-a',
    };
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'iptvnator-source-config-'));
        (getIptvnatorDataRoot as jest.Mock).mockReturnValue(directory);
        (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(true);
    });
    afterEach(() => {
        clearSourceServerConfig();
        rmSync(directory, { recursive: true, force: true });
        if (originalProfile === undefined)
            delete process.env.IPTVNATOR_SOURCE_PROFILE;
        else process.env.IPTVNATOR_SOURCE_PROFILE = originalProfile;
    });
    it('stores an encrypted token and selects a filesystem-safe isolated profile', () => {
        expect(saveSourceServerConfig(connection, 'synthetic-token')).toBe(
            true
        );
        const text = readFileSync(
            join(directory, 'source-server.json'),
            'utf8'
        );
        expect(text).not.toContain('synthetic-token');
        expect(JSON.parse(text)).toMatchObject({
            ...connection,
            encryptedToken: expect.any(String),
        });
        expect(sourceServerToken(readSourceServerConfig()!)).toBe(
            'synthetic-token'
        );
        activateSourceServerProfile();
        expect(process.env.IPTVNATOR_SOURCE_PROFILE).toMatch(/^[a-f0-9]{64}$/);
        const original = process.env.IPTVNATOR_SOURCE_PROFILE;
        saveSourceServerConfig({ ...connection, instanceId: 'instance-b' }, '');
        activateSourceServerProfile();
        expect(process.env.IPTVNATOR_SOURCE_PROFILE).not.toBe(original);
    });
    it('retains a process-only token when protected storage is unavailable', () => {
        (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(false);
        expect(saveSourceServerConfig(connection, 'session-only')).toBe(false);
        expect(
            readFileSync(join(directory, 'source-server.json'), 'utf8')
        ).not.toContain('session-only');
        expect(sourceServerToken(readSourceServerConfig()!)).toBe(
            'session-only'
        );
    });
    it('clears an inherited server profile when startup has no connection', () => {
        process.env.IPTVNATOR_SOURCE_PROFILE = 'inherited-server-profile';
        activateSourceServerProfile();
        expect(process.env.IPTVNATOR_SOURCE_PROFILE).toBeUndefined();
    });
    it.each([
        '{truncated',
        'null',
        '{"apiUrl":"file:///private","instanceId":"a"}',
    ])(
        'opens a separate recovery profile and retains unreadable configuration: %s',
        (raw) => {
            const path = join(directory, 'source-server.json');
            writeFileSync(path, raw);
            process.env.IPTVNATOR_SOURCE_PROFILE = 'inherited';
            expect(() => activateSourceServerProfile()).not.toThrow();
            expect(process.env.IPTVNATOR_SOURCE_PROFILE).toMatch(
                /^[a-f0-9]{64}$/
            );
            expect(() => readSourceServerConfig()).toThrow(
                'SOURCE_SYNC.INCOMPATIBLE'
            );
            expect(readFileSync(path, 'utf8')).toBe(raw);
            const recovery = process.env.IPTVNATOR_SOURCE_PROFILE;
            saveSourceServerConfig(connection, '');
            expect(readdirSync(directory)).toEqual(['source-server.json']);
            activateSourceServerProfile();
            expect(process.env.IPTVNATOR_SOURCE_PROFILE).not.toBe(recovery);
        }
    );
    it('removes the active profile before Electron relaunches after disconnect', () => {
        saveSourceServerConfig(connection, '');
        activateSourceServerProfile();
        expect(process.env.IPTVNATOR_SOURCE_PROFILE).toBeDefined();
        clearSourceServerConfig();
        expect(readSourceServerConfig()).toBeNull();
        expect(process.env.IPTVNATOR_SOURCE_PROFILE).toBeUndefined();
    });
});
