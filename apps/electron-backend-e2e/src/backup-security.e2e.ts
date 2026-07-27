import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
    PlaylistBackupManifestV1,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import {
    closeElectronApp,
    defaultXtreamPassword,
    defaultXtreamUsername,
    expect,
    launchElectronApp,
    openSettings,
    resetMockServers,
    test,
    xtreamMockServer,
} from './electron-test-fixtures';
import {
    exportBackupThroughUi,
    makeLocalXtreamCredentialsIncomplete,
    readAllPlaylists,
    readManifest,
    readPlaylist,
    requireStalkerEntry,
    requireXtreamEntry,
    seedProviderPlaylists,
    SKIPPED_XTREAM_PLAYLIST_ID,
    STALKER_LEGACY_DEVICE_ID_1,
    STALKER_LEGACY_DEVICE_ID_2,
    STALKER_LEGACY_SERIAL,
    STALKER_LEGACY_SIGNATURE_1,
    STALKER_LEGACY_SIGNATURE_2,
    STALKER_PASSWORD,
    STALKER_PLAYLIST_ID,
    STALKER_STRUCTURED_SERIAL,
    STALKER_USERNAME,
    XTREAM_PLAYLIST_ID,
} from './support/backup-security';

test.describe('Electron playlist backup security acceptance', () => {
    test('@backup @electron redacts exports and safely resolves redacted Xtream credentials on import', async ({
        dataDir,
        request,
    }) => {
        test.setTimeout(120000);
        await resetMockServers(request, ['xtream']);

        const redactedExportPath = join(
            dataDir,
            'backup-security-redacted.json'
        );
        const secretsExportPath = join(
            dataDir,
            'backup-security-with-secrets.json'
        );
        const importPath = join(dataDir, 'backup-security-import.json');
        const app = await launchElectronApp(dataDir);

        try {
            await seedProviderPlaylists(app.mainWindow);
            await openSettings(app.mainWindow);

            const backupSection = app.mainWindow.locator('#backup');
            const redactedWarning = backupSection.locator(
                '#backup-redacted-warning'
            );
            const secretsWarning = backupSection.locator(
                '#backup-secrets-warning'
            );
            const includeSecretsHost = backupSection.getByTestId(
                'backup-include-secrets'
            );
            const includeSecretsCheckbox = backupSection.getByRole('checkbox', {
                name: 'Include portal credentials and Stalker device identity',
            });

            await expect(redactedWarning).toBeVisible();
            await expect(redactedWarning).toContainText('MAC addresses');
            await expect(includeSecretsCheckbox).not.toBeChecked();
            await expect(secretsWarning).toHaveCount(0);

            await exportBackupThroughUi(
                app.electronApp,
                backupSection,
                redactedExportPath
            );
            const redactedManifest = readManifest(redactedExportPath);
            const redactedXtream = requireXtreamEntry(
                redactedManifest,
                XTREAM_PLAYLIST_ID
            );
            const redactedStalker = requireStalkerEntry(
                redactedManifest,
                STALKER_PLAYLIST_ID
            );

            expect(redactedManifest.includeSecrets).toBe(false);
            expect(redactedXtream.connection).toEqual({
                credentialsOmitted: true,
                serverUrl: xtreamMockServer,
            });
            expect(redactedStalker.connection).toMatchObject({
                macAddress: '00:1A:79:AA:BB:CC',
                portalUrl: 'https://stalker-backup.test/server/load.php',
            });
            expect(redactedStalker.connection).not.toHaveProperty('username');
            expect(redactedStalker.connection).not.toHaveProperty('password');
            expect(redactedStalker.connection).not.toHaveProperty(
                'identityOverrides'
            );
            expect(redactedStalker.connection).not.toHaveProperty(
                'stalkerSerialNumber'
            );
            expect(redactedStalker.connection).not.toHaveProperty(
                'stalkerDeviceId1'
            );
            expect(redactedStalker.connection).not.toHaveProperty(
                'stalkerDeviceId2'
            );
            expect(redactedStalker.connection).not.toHaveProperty(
                'stalkerSignature1'
            );
            expect(redactedStalker.connection).not.toHaveProperty(
                'stalkerSignature2'
            );
            expect(JSON.stringify(redactedManifest)).not.toContain(
                defaultXtreamPassword
            );
            expect(JSON.stringify(redactedManifest)).not.toContain(
                STALKER_PASSWORD
            );
            expect(JSON.stringify(redactedManifest)).not.toContain(
                STALKER_STRUCTURED_SERIAL
            );
            expect(JSON.stringify(redactedManifest)).not.toContain(
                'stale-stalker-token'
            );

            await includeSecretsCheckbox.check();
            await expect(includeSecretsCheckbox).toBeChecked();
            await expect(redactedWarning).toBeVisible();
            await expect(secretsWarning).toBeVisible();
            await expect(secretsWarning).toContainText(
                'Store the backup securely'
            );
            await expect(includeSecretsHost).toHaveAttribute(
                'aria-describedby',
                'backup-redacted-warning backup-secrets-warning'
            );

            await exportBackupThroughUi(
                app.electronApp,
                backupSection,
                secretsExportPath
            );
            const secretsManifest = readManifest(secretsExportPath);
            const secretsXtream = requireXtreamEntry(
                secretsManifest,
                XTREAM_PLAYLIST_ID
            );
            const secretsStalker = requireStalkerEntry(
                secretsManifest,
                STALKER_PLAYLIST_ID
            );

            expect(secretsManifest.includeSecrets).toBe(true);
            expect(secretsXtream.connection).toEqual({
                password: defaultXtreamPassword,
                serverUrl: xtreamMockServer,
                username: defaultXtreamUsername,
            });
            expect(secretsStalker.connection).toMatchObject({
                identityOverrides: {
                    deviceId1: 'STRUCTURED-BACKUP-DEVICE-1',
                    serialNumber: STALKER_STRUCTURED_SERIAL,
                },
                password: STALKER_PASSWORD,
                stalkerDeviceId1: STALKER_LEGACY_DEVICE_ID_1,
                stalkerDeviceId2: STALKER_LEGACY_DEVICE_ID_2,
                stalkerSerialNumber: STALKER_LEGACY_SERIAL,
                stalkerSignature1: STALKER_LEGACY_SIGNATURE_1,
                stalkerSignature2: STALKER_LEGACY_SIGNATURE_2,
                username: STALKER_USERNAME,
            });
            expect(JSON.stringify(secretsManifest)).not.toContain(
                'stale-stalker-token'
            );

            const skippedXtream: XtreamPlaylistBackupEntry = {
                ...redactedXtream,
                exportedId: SKIPPED_XTREAM_PLAYLIST_ID,
                title: 'Redacted Xtream To Skip',
                connection: { ...redactedXtream.connection },
                userState: {
                    favorites: [],
                    hiddenCategories: [],
                    playbackPositions: [],
                    recentlyViewed: [],
                },
            };
            const importManifest: PlaylistBackupManifestV1 = {
                ...redactedManifest,
                playlists: [
                    {
                        ...redactedXtream,
                        connection: { ...redactedXtream.connection },
                        userState: {
                            favorites: [],
                            hiddenCategories: [],
                            playbackPositions: [],
                            recentlyViewed: [],
                        },
                    },
                    skippedXtream,
                ],
            };
            writeFileSync(
                importPath,
                JSON.stringify(importManifest, null, 2),
                'utf-8'
            );

            await makeLocalXtreamCredentialsIncomplete(app.mainWindow);
            const incompleteLocal = await readPlaylist(
                app.mainWindow,
                XTREAM_PLAYLIST_ID
            );
            expect(incompleteLocal).toMatchObject({
                _id: XTREAM_PLAYLIST_ID,
                password: '',
                serverUrl: xtreamMockServer,
                username: '',
            });

            const fileChooserPromise =
                app.mainWindow.waitForEvent('filechooser');
            await backupSection
                .getByRole('button', { name: 'Import', exact: true })
                .click();
            const fileChooser = await fileChooserPromise;
            await fileChooser.setFiles(importPath);

            const importDialog = app.mainWindow
                .locator('mat-dialog-container')
                .filter({ hasText: redactedXtream.title });
            await expect(importDialog).toBeVisible({ timeout: 15000 });
            await expect(
                importDialog.getByRole('heading', {
                    name: 'Xtream credentials required',
                })
            ).toBeVisible();
            await expect(importDialog).toContainText('localhost:3211');
            await importDialog
                .getByLabel('Username')
                .fill(defaultXtreamUsername);
            await importDialog
                .getByLabel('Password')
                .fill(defaultXtreamPassword);
            await importDialog
                .getByRole('button', {
                    name: 'Import playlist',
                    exact: true,
                })
                .click();
            await expect(importDialog).toBeHidden({ timeout: 15000 });

            const skipDialog = app.mainWindow
                .locator('mat-dialog-container')
                .filter({ hasText: skippedXtream.title });
            await expect(skipDialog).toBeVisible({ timeout: 15000 });
            await skipDialog
                .getByRole('button', {
                    name: 'Skip playlist',
                    exact: true,
                })
                .click();
            await expect(skipDialog).toBeHidden();

            await expect(
                app.mainWindow.getByText(
                    'Backup import finished: 0 imported, 1 merged, 1 skipped, 0 failed.'
                )
            ).toBeVisible({ timeout: 15000 });

            const restoredXtream = await readPlaylist(
                app.mainWindow,
                XTREAM_PLAYLIST_ID
            );
            expect(restoredXtream).toMatchObject({
                _id: XTREAM_PLAYLIST_ID,
                count: 42,
                importDate: '2026-07-01T00:00:00.000Z',
                lastUsage: '2026-07-20T00:00:00.000Z',
                origin: 'https://local-display.test',
                password: defaultXtreamPassword,
                referrer: 'https://local-display.test/player',
                serverTimezone: 'Europe/Berlin',
                serverUrl: xtreamMockServer,
                updateDate: 1784505600000,
                userAgent: 'Local Xtream Presentation/9.9',
                username: defaultXtreamUsername,
            });
            expect(
                await readPlaylist(app.mainWindow, SKIPPED_XTREAM_PLAYLIST_ID)
            ).toBeNull();

            const allPlaylists = await readAllPlaylists(app.mainWindow);
            expect(allPlaylists).toHaveLength(2);
            expect(
                allPlaylists.some(
                    (playlist) =>
                        playlist._id === SKIPPED_XTREAM_PLAYLIST_ID ||
                        playlist.title === skippedXtream.title
                )
            ).toBe(false);
        } finally {
            await closeElectronApp(app);
        }
    });
});
