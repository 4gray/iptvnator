const homedirMock = jest.fn<string, []>();

jest.mock('os', () => ({
    ...jest.requireActual('os'),
    homedir: () => homedirMock(),
}));

import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    IPTVNATOR_E2E_DATA_DIR_ENV,
    getElectronConfigDirectory,
    getElectronUserDataPath,
    getIptvnatorDataRoot,
    getIptvnatorDatabaseDirectory,
    getIptvnatorDatabasePath,
} from './path-utils';

describe('path-utils', () => {
    let tempRoot: string;
    let originalEnvValue: string | undefined;

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'iptvnator-path-utils-'));
        homedirMock.mockReturnValue(join(tempRoot, 'home'));
        originalEnvValue = process.env[IPTVNATOR_E2E_DATA_DIR_ENV];
        delete process.env[IPTVNATOR_E2E_DATA_DIR_ENV];
    });

    afterEach(() => {
        if (originalEnvValue === undefined) {
            delete process.env[IPTVNATOR_E2E_DATA_DIR_ENV];
        } else {
            process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = originalEnvValue;
        }
        rmSync(tempRoot, { force: true, recursive: true });
    });

    it('uses and creates the E2E data dir override when the env variable is set', () => {
        const e2eDataDir = join(tempRoot, 'e2e-data');
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = e2eDataDir;

        expect(getIptvnatorDataRoot()).toBe(e2eDataDir);
        expect(existsSync(e2eDataDir)).toBe(true);
    });

    it('falls back to ~/.iptvnator when the env override is blank', () => {
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = '   ';

        const expectedRoot = join(tempRoot, 'home', '.iptvnator');

        expect(getIptvnatorDataRoot()).toBe(expectedRoot);
        expect(existsSync(expectedRoot)).toBe(true);
    });

    it('places the databases directory and database file under the data root', () => {
        const e2eDataDir = join(tempRoot, 'e2e-data');
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = e2eDataDir;

        const databaseDirectory = getIptvnatorDatabaseDirectory();

        expect(databaseDirectory).toBe(join(e2eDataDir, 'databases'));
        expect(existsSync(databaseDirectory)).toBe(true);
        expect(getIptvnatorDatabasePath()).toBe(
            join(e2eDataDir, 'databases', 'iptvnator.db')
        );
    });

    it('returns null Electron user-data and config paths outside E2E runs', () => {
        expect(getElectronUserDataPath()).toBeNull();
        expect(getElectronConfigDirectory()).toBeNull();
    });

    it('creates Electron user-data and config directories under the E2E root', () => {
        const e2eDataDir = join(tempRoot, 'e2e-data');
        process.env[IPTVNATOR_E2E_DATA_DIR_ENV] = e2eDataDir;

        const userDataPath = getElectronUserDataPath();
        const configDirectory = getElectronConfigDirectory();

        expect(userDataPath).toBe(join(e2eDataDir, 'user-data'));
        expect(configDirectory).toBe(join(e2eDataDir, 'config'));
        expect(existsSync(userDataPath as string)).toBe(true);
        expect(existsSync(configDirectory as string)).toBe(true);
    });
});
