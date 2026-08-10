import type { Page } from '@playwright/test';
import {
    addStalkerPortal,
    closeElectronApp,
    expect,
    launchElectronApp,
    openSourceEditor,
    openSources,
    resetMockServers,
    restartElectronApp,
    sourceRowByTitle,
    stalkerMockServer,
    test,
    updateSourceDialog,
    saveSourceDialog,
    waitForStalkerCatalog,
} from './electron-test-fixtures';

/**
 * Endpoint discovery + behavior-based portal mode (issues #850, #686, #755).
 *
 * One persisted field — `isFullStalkerPortal` — decides whether the app
 * authenticates at all. It used to be a URL-shape guess frozen at import:
 * canonical `…/server/load.php` portals were persisted as token-free (every
 * request answered the plain-text `Authorization failed.`), and `…/c` URLs
 * were rewritten to a `portal.php` official Ministra never serves (404).
 *
 * The mock mirrors both worlds: `/portal.php` is a tolerant reseller panel,
 * `/server/load.php` enforces the Bearer token like real middleware, and the
 * `/ministra/*` prefix serves ONLY `server/load.php` — a genuine Ministra
 * host where `portal.php` 404s.
 */

// Non-scenario MACs: every MAC gets deterministic auto-generated catalog
// data, and per-MAC state cannot collide with the scenario MACs other spec
// files rely on.
const CANONICAL_IMPORT_MAC = '00:1A:79:00:00:21';
const MINISTRA_IMPORT_MAC = '00:1A:79:00:00:22';
const RESELLER_IMPORT_MAC = '00:1A:79:00:00:23';
const BARE_HOST_IMPORT_MAC = '00:1A:79:00:00:27';
const REPAIR_FLAG_MAC = '00:1A:79:00:00:24';
const REPAIR_ENDPOINT_MAC = '00:1A:79:00:00:25';
const HEALTHY_RESELLER_MAC = '00:1A:79:00:00:26';

interface StoredPortalConfig {
    portalUrl: unknown;
    isFullStalkerPortal: unknown;
}

type PlaylistStorageWindow = Window & {
    electron: {
        dbGetAppPlaylists: () => Promise<Record<string, unknown>[]>;
        dbUpsertAppPlaylist: (
            playlist: Record<string, unknown>
        ) => Promise<unknown>;
    };
};

async function readStoredPortalConfig(
    page: Page,
    title: string
): Promise<StoredPortalConfig | null> {
    return page.evaluate(async (playlistTitle) => {
        const electron = (window as unknown as PlaylistStorageWindow).electron;
        const playlists = await electron.dbGetAppPlaylists();
        const row = playlists.find(
            (playlist) => playlist['title'] === playlistTitle
        );
        return row
            ? {
                  portalUrl: row['portalUrl'],
                  isFullStalkerPortal: row['isFullStalkerPortal'],
              }
            : null;
    }, title);
}

async function seedStalkerPlaylist(
    page: Page,
    row: {
        id: string;
        title: string;
        macAddress: string;
        portalUrl: string;
        isFullStalkerPortal: boolean;
    }
): Promise<void> {
    const nowIso = new Date().toISOString();
    await page.evaluate(
        async (playlist) => {
            const electron = (window as unknown as PlaylistStorageWindow)
                .electron;
            await electron.dbUpsertAppPlaylist(playlist);
        },
        {
            _id: row.id,
            title: row.title,
            macAddress: row.macAddress,
            portalUrl: row.portalUrl,
            isFullStalkerPortal: row.isFullStalkerPortal,
            count: 0,
            autoRefresh: false,
            importDate: nowIso,
            lastUsage: nowIso,
            favorites: [],
            recentlyViewed: [],
        }
    );
}

async function openSeededPortal(page: Page, title: string): Promise<void> {
    await openSources(page);
    await sourceRowByTitle(page, title).first().click();
    await waitForStalkerCatalog(page);
}

test('@electron @stalker Add and Edit discover bare, canonical, Ministra and reseller URLs', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(240_000);
    await resetMockServers(request, ['stalker']);

    const app = await launchElectronApp(dataDir);

    try {
        // 1) Canonical Ministra endpoint pasted directly (#850): the old
        // import predicate missed `/server/load.php`, persisted the portal
        // as token-free and every content request answered the plain-text
        // "Authorization failed." — portal added, no content.
        await addStalkerPortal(app.mainWindow, {
            name: 'Canonical Load PHP',
            macAddress: CANONICAL_IMPORT_MAC,
            portalUrl: `${stalkerMockServer}/server/load.php`,
        });
        await waitForStalkerCatalog(app.mainWindow);
        expect(
            await readStoredPortalConfig(app.mainWindow, 'Canonical Load PHP')
        ).toEqual({
            portalUrl: `${stalkerMockServer}/server/load.php`,
            isFullStalkerPortal: true,
        });

        // 2) The `…/c` browser URL on a genuine Ministra host (#686/#755):
        // the old rewrite produced `…/portal.php`, which 404s there. The
        // probe must fall through the 404 to `server/load.php` and persist
        // full-portal mode.
        await openSources(app.mainWindow);
        await addStalkerPortal(app.mainWindow, {
            name: 'Ministra Slash C',
            macAddress: MINISTRA_IMPORT_MAC,
            portalUrl: `${stalkerMockServer}/ministra/c`,
        });
        await waitForStalkerCatalog(app.mainWindow);
        expect(
            await readStoredPortalConfig(app.mainWindow, 'Ministra Slash C')
        ).toEqual({
            portalUrl: `${stalkerMockServer}/ministra/server/load.php`,
            isFullStalkerPortal: true,
        });

        // 3) Reseller `…/c` URL: portal.php answers without a token, so the
        // pre-discovery behavior (portal.php endpoint, simple mode, no
        // handshake) must be preserved exactly.
        await openSources(app.mainWindow);
        await addStalkerPortal(app.mainWindow, {
            name: 'Reseller Panel',
            macAddress: RESELLER_IMPORT_MAC,
            portalUrl: `${stalkerMockServer}/c`,
        });
        await waitForStalkerCatalog(app.mainWindow);
        expect(
            await readStoredPortalConfig(app.mainWindow, 'Reseller Panel')
        ).toEqual({
            portalUrl: `${stalkerMockServer}/portal.php`,
            isFullStalkerPortal: false,
        });

        // 4) A bare host is valid input. The reseller endpoint answers first,
        // so Add persists the resolved API handler rather than root HTML.
        await openSources(app.mainWindow);
        await addStalkerPortal(app.mainWindow, {
            name: 'Bare Host',
            macAddress: BARE_HOST_IMPORT_MAC,
            portalUrl: stalkerMockServer,
        });
        await waitForStalkerCatalog(app.mainWindow);
        expect(
            await readStoredPortalConfig(app.mainWindow, 'Bare Host')
        ).toEqual({
            portalUrl: `${stalkerMockServer}/portal.php`,
            isFullStalkerPortal: false,
        });

        // Edit uses the same discovery path as Add. Moving the source to a
        // genuine Ministra tenant must replace endpoint and mode together.
        await openSources(app.mainWindow);
        const editDialog = await openSourceEditor(app.mainWindow, 'Bare Host');
        await updateSourceDialog(editDialog, {
            portalUrl: `${stalkerMockServer}/ministra/c`,
        });
        await saveSourceDialog(app.mainWindow, editDialog);
        await expect
            .poll(() => readStoredPortalConfig(app.mainWindow, 'Bare Host'))
            .toEqual({
                portalUrl: `${stalkerMockServer}/ministra/server/load.php`,
                isFullStalkerPortal: true,
            });
    } finally {
        await closeElectronApp(app);
    }
});

test('@electron @stalker lazy repair fixes misclassified stored portals and never touches working ones', async ({
    dataDir,
    request,
}) => {
    test.setTimeout(240_000);
    await resetMockServers(request, ['stalker']);

    let app = await launchElectronApp(dataDir);

    try {
        // Rows exactly as the pre-discovery code persisted them.
        await seedStalkerPlaylist(app.mainWindow, {
            id: 'repair-flag-only',
            title: 'Misclassified Canonical',
            macAddress: REPAIR_FLAG_MAC,
            portalUrl: `${stalkerMockServer}/server/load.php`,
            // The old import predicate persisted false for this URL.
            isFullStalkerPortal: false,
        });
        await seedStalkerPlaylist(app.mainWindow, {
            id: 'repair-endpoint',
            title: 'Broken Portal PHP Rewrite',
            macAddress: REPAIR_ENDPOINT_MAC,
            // The old `…/c` rewrite on a genuine Ministra host: 404 forever.
            portalUrl: `${stalkerMockServer}/ministra/portal.php`,
            isFullStalkerPortal: false,
        });
        await seedStalkerPlaylist(app.mainWindow, {
            id: 'healthy-reseller',
            title: 'Healthy Reseller',
            macAddress: HEALTHY_RESELLER_MAC,
            portalUrl: `${stalkerMockServer}/portal.php`,
            isFullStalkerPortal: false,
        });

        // Fresh session so the seeded rows load like any long-existing
        // playlist (the repair must work for users, not for this test).
        const restarted = await restartElectronApp(app, dataDir);
        app = restarted;

        // Misclassified canonical portal: the first content request answers
        // the plain-text auth failure, repair re-probes, proves the endpoint
        // enforces the token, flips ONLY the flag and retries — the catalog
        // must render in the same session.
        await openSeededPortal(app.mainWindow, 'Misclassified Canonical');
        await expect
            .poll(() =>
                readStoredPortalConfig(
                    app.mainWindow,
                    'Misclassified Canonical'
                )
            )
            .toEqual({
                portalUrl: `${stalkerMockServer}/server/load.php`,
                isFullStalkerPortal: true,
            });

        // Dead portal.php rewrite: the 404 triggers the repair, which lands
        // on the canonical endpoint in full mode.
        await openSeededPortal(app.mainWindow, 'Broken Portal PHP Rewrite');
        await expect
            .poll(() =>
                readStoredPortalConfig(
                    app.mainWindow,
                    'Broken Portal PHP Rewrite'
                )
            )
            .toEqual({
                portalUrl: `${stalkerMockServer}/ministra/server/load.php`,
                isFullStalkerPortal: true,
            });

        // Working reseller panel: browsing succeeds without any auth, so the
        // repair never runs and the stored row stays byte-identical — the
        // conservative core of the migration story.
        await openSeededPortal(app.mainWindow, 'Healthy Reseller');
        expect(
            await readStoredPortalConfig(app.mainWindow, 'Healthy Reseller')
        ).toEqual({
            portalUrl: `${stalkerMockServer}/portal.php`,
            isFullStalkerPortal: false,
        });
    } finally {
        await closeElectronApp(app);
    }
});
