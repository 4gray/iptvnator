import { existsSync, readFileSync } from 'node:fs';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type {
    Playlist,
    PlaylistBackupManifestV1,
    StalkerPlaylistBackupEntry,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import {
    defaultXtreamPassword,
    defaultXtreamUsername,
    xtreamMockServer,
} from '../electron-test-fixtures';

export const XTREAM_PLAYLIST_ID = 'backup-security-xtream';
export const STALKER_PLAYLIST_ID = 'backup-security-stalker';
export const SKIPPED_XTREAM_PLAYLIST_ID = 'backup-security-xtream-skipped';
export const STALKER_USERNAME = 'stalker-backup-user';
export const STALKER_PASSWORD = 'stalker-backup-password';
export const STALKER_STRUCTURED_SERIAL = 'STRUCTURED-BACKUP-SERIAL';
export const STALKER_LEGACY_SERIAL = 'LEGACY-BACKUP-SERIAL';
export const STALKER_LEGACY_DEVICE_ID_1 = 'LEGACY-BACKUP-DEVICE-1';
export const STALKER_LEGACY_DEVICE_ID_2 = 'LEGACY-BACKUP-DEVICE-2';
export const STALKER_LEGACY_SIGNATURE_1 = 'LEGACY-BACKUP-SIGNATURE-1';
export const STALKER_LEGACY_SIGNATURE_2 = 'LEGACY-BACKUP-SIGNATURE-2';

export async function seedProviderPlaylists(page: Page): Promise<void> {
    await waitForDatabaseReady(page);

    const playlists: Playlist[] = [
        {
            _id: XTREAM_PLAYLIST_ID,
            autoRefresh: true,
            count: 42,
            importDate: '2026-07-01T00:00:00.000Z',
            lastUsage: '2026-07-20T00:00:00.000Z',
            origin: 'https://local-display.test',
            password: defaultXtreamPassword,
            position: 7,
            referrer: 'https://local-display.test/player',
            serverTimezone: 'Europe/Berlin',
            serverUrl: xtreamMockServer,
            title: 'Backup Security Xtream',
            updateDate: 1784505600000,
            userAgent: 'Local Xtream Presentation/9.9',
            username: defaultXtreamUsername,
        },
        {
            _id: STALKER_PLAYLIST_ID,
            autoRefresh: false,
            count: 0,
            importDate: '2026-07-02T00:00:00.000Z',
            isFullStalkerPortal: true,
            lastUsage: '2026-07-21T00:00:00.000Z',
            macAddress: '00:1A:79:AA:BB:CC',
            origin: 'https://stalker-backup.test',
            password: STALKER_PASSWORD,
            portalUrl: 'https://stalker-backup.test/server/load.php',
            referrer: 'https://stalker-backup.test/c/',
            stalkerAccountInfo: {
                login: STALKER_USERNAME,
                status: 1,
            },
            stalkerDeviceId1: STALKER_LEGACY_DEVICE_ID_1,
            stalkerDeviceId2: STALKER_LEGACY_DEVICE_ID_2,
            stalkerIdentityOverrides: {
                deviceId1: 'STRUCTURED-BACKUP-DEVICE-1',
                serialNumber: STALKER_STRUCTURED_SERIAL,
            },
            stalkerProfilePreset: {
                id: 'mag250-public-5_1-minimal-v1',
                version: 1,
            },
            stalkerSerialNumber: STALKER_LEGACY_SERIAL,
            stalkerSignature1: STALKER_LEGACY_SIGNATURE_1,
            stalkerSignature2: STALKER_LEGACY_SIGNATURE_2,
            stalkerSourceUrl: 'https://stalker-backup.test/c/',
            stalkerToken: 'stale-stalker-token',
            title: 'Backup Security Stalker',
            userAgent: 'Mozilla/5.0 (QtEmbedded; U; Linux; C) MAG250',
            username: STALKER_USERNAME,
        },
    ];

    await page.evaluate(async (seed) => {
        const upsert = window.electron?.dbUpsertAppPlaylists;
        if (!upsert) {
            throw new Error('playlist-bulk-upsert-unavailable');
        }
        const result = await upsert(seed);
        if (!result.success || result.count !== seed.length) {
            throw new Error(
                `playlist-bulk-upsert-failed:${JSON.stringify(result)}`
            );
        }
    }, playlists);
}

async function waitForDatabaseReady(page: Page): Promise<void> {
    await expect
        .poll(
            () =>
                page.evaluate(async () => {
                    const electron = window.electron;
                    if (!electron) {
                        return false;
                    }
                    try {
                        await (electron.dbGetAppPlaylistMetas?.() ??
                            electron.dbGetAppPlaylists?.());
                        return true;
                    } catch {
                        return false;
                    }
                }),
            { timeout: 30000 }
        )
        .toBe(true);
}

export async function exportBackupThroughUi(
    electronApp: ElectronApplication,
    backupSection: Locator,
    exportPath: string
): Promise<void> {
    await electronApp.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: path,
        });
    }, exportPath);

    await backupSection
        .getByRole('button', { name: 'Export', exact: true })
        .click();
    await expect
        .poll(() => isCompleteJsonFile(exportPath), {
            message: `Backup was not written to ${exportPath}`,
            timeout: 15000,
        })
        .toBe(true);
    await expect(
        backupSection.getByRole('button', { name: 'Export', exact: true })
    ).toBeEnabled();
}

function isCompleteJsonFile(filePath: string): boolean {
    if (!existsSync(filePath)) {
        return false;
    }
    try {
        JSON.parse(readFileSync(filePath, 'utf-8'));
        return true;
    } catch {
        return false;
    }
}

export function readManifest(filePath: string): PlaylistBackupManifestV1 {
    return JSON.parse(
        readFileSync(filePath, 'utf-8')
    ) as PlaylistBackupManifestV1;
}

export function requireXtreamEntry(
    manifest: PlaylistBackupManifestV1,
    playlistId: string
): XtreamPlaylistBackupEntry {
    const entry = manifest.playlists.find(
        (candidate): candidate is XtreamPlaylistBackupEntry =>
            candidate.portalType === 'xtream' &&
            candidate.exportedId === playlistId
    );
    if (!entry) {
        throw new Error(`xtream-backup-entry-missing:${playlistId}`);
    }
    return entry;
}

export function requireStalkerEntry(
    manifest: PlaylistBackupManifestV1,
    playlistId: string
): StalkerPlaylistBackupEntry {
    const entry = manifest.playlists.find(
        (candidate): candidate is StalkerPlaylistBackupEntry =>
            candidate.portalType === 'stalker' &&
            candidate.exportedId === playlistId
    );
    if (!entry) {
        throw new Error(`stalker-backup-entry-missing:${playlistId}`);
    }
    return entry;
}

export async function makeLocalXtreamCredentialsIncomplete(
    page: Page
): Promise<void> {
    await page.evaluate(async (playlistId) => {
        const read = window.electron?.dbGetAppPlaylist;
        const update = window.electron?.dbUpdatePlaylist;
        if (!read || !update) {
            throw new Error('playlist-read-write-unavailable');
        }
        const playlist = await read(playlistId);
        if (!playlist) {
            throw new Error(`playlist-missing:${playlistId}`);
        }
        const result = await update(playlistId, {
            password: '',
            username: '',
        });
        if (!result.success) {
            throw new Error(`playlist-update-failed:${playlistId}`);
        }
    }, XTREAM_PLAYLIST_ID);
}

export async function readPlaylist(
    page: Page,
    playlistId: string
): Promise<Playlist | null> {
    return page.evaluate(async (id) => {
        const read = window.electron?.dbGetAppPlaylist;
        if (!read) {
            throw new Error('playlist-read-unavailable');
        }
        return read(id);
    }, playlistId);
}

export async function readAllPlaylists(page: Page): Promise<Playlist[]> {
    return page.evaluate(async () => {
        const read = window.electron?.dbGetAppPlaylists;
        if (!read) {
            throw new Error('playlist-list-unavailable');
        }
        return read();
    });
}
