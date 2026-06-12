import { resolve } from 'node:path';
import { DownloadDirectoryAuthorizer } from './download-directory-authorization';

describe('DownloadDirectoryAuthorizer', () => {
    it('returns a previously authorized native-dialog selection', async () => {
        const authorizer = new DownloadDirectoryAuthorizer({
            getDefaultDirectory: () => '/downloads',
            loadSelectedDirectory: async () => '/media/iptv',
            saveSelectedDirectory: jest.fn(),
        });

        await expect(authorizer.getPreferredDirectory()).resolves.toBe(
            resolve('/media/iptv')
        );
        await expect(authorizer.requireAuthorized('/media/iptv')).resolves.toBe(
            resolve('/media/iptv')
        );
    });

    it('rejects a renderer-supplied directory that was never authorized', async () => {
        const authorizer = new DownloadDirectoryAuthorizer({
            getDefaultDirectory: () => '/downloads',
            loadSelectedDirectory: async () => null,
            saveSelectedDirectory: jest.fn(),
        });

        await expect(
            authorizer.requireAuthorized('/tmp/renderer-controlled')
        ).rejects.toThrow(/not authorized/i);
    });

    it('persists and authorizes a directory selected by the native dialog', async () => {
        const saveSelectedDirectory = jest.fn().mockResolvedValue(undefined);
        const authorizer = new DownloadDirectoryAuthorizer({
            getDefaultDirectory: () => '/downloads',
            loadSelectedDirectory: async () => null,
            saveSelectedDirectory,
        });

        await expect(
            authorizer.authorizeSelectedDirectory('/media/iptv')
        ).resolves.toBe(resolve('/media/iptv'));
        expect(saveSelectedDirectory).toHaveBeenCalledWith(
            resolve('/media/iptv')
        );
        await expect(authorizer.requireAuthorized('/media/iptv')).resolves.toBe(
            resolve('/media/iptv')
        );
    });

    it('matches authorized paths case-insensitively on Windows', async () => {
        const authorizer = new DownloadDirectoryAuthorizer({
            getDefaultDirectory: () => 'C:\\Downloads',
            loadSelectedDirectory: async () => 'C:\\Media\\IPTV',
            saveSelectedDirectory: jest.fn(),
            platform: 'win32',
        });

        await expect(
            authorizer.requireAuthorized('c:\\media\\iptv')
        ).resolves.toBe(resolve('c:\\media\\iptv'));
    });

    it('keeps authorized path matching case-sensitive on POSIX', async () => {
        const authorizer = new DownloadDirectoryAuthorizer({
            getDefaultDirectory: () => '/downloads',
            loadSelectedDirectory: async () => '/media/IPTV',
            saveSelectedDirectory: jest.fn(),
            platform: 'linux',
        });

        await expect(
            authorizer.requireAuthorized('/media/iptv')
        ).rejects.toThrow(/not authorized/i);
    });
});
