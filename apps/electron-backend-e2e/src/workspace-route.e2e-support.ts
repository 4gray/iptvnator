import type { Page } from '@playwright/test';

/**
 * Moves the renderer to a workspace route without reloading it, as a router
 * link would. The packaged renderer lives below its own path, so only the
 * part from `/workspace` on is replaced.
 */
export async function navigateWithinWorkspace(
    page: Page,
    path: string
): Promise<void> {
    const targetPathname = await page.evaluate((target) => {
        const targetUrl = new URL(window.location.href);
        const workspaceIndex = targetUrl.pathname.lastIndexOf('/workspace');
        const rendererPath =
            workspaceIndex >= 0
                ? targetUrl.pathname.slice(0, workspaceIndex)
                : targetUrl.pathname.replace(/\/$/, '');

        targetUrl.pathname = `${rendererPath}${target}`;
        targetUrl.search = '';
        targetUrl.hash = '';
        window.history.pushState(null, '', targetUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return targetUrl.pathname;
    }, path);
    await page.waitForURL((url) => url.pathname === targetPathname);
}
