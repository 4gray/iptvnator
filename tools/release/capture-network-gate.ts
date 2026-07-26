/**
 * The Electron-side half of G3: a request gate in the main process covering
 * both Chromium's network stack and Node's `fetch`.
 *
 * Known and unavoidable timing window: this can only be installed once
 * `electron.launch()` resolves, and Playwright releases Electron's ready
 * event before that — so a Node-stack request fired in the first
 * milliseconds of `app.whenReady()` would escape it. It cannot be closed
 * from the test side: Playwright deletes `NODE_OPTIONS` unconditionally
 * (`playwright-core/lib/server/electron/electron.js`), which rules out a
 * `--require` preload, and it exposes no pre-ready hook. Closing it entirely
 * would mean holding renderer startup from inside `main.ts` — production code
 * bent around a screenshot tool.
 *
 * What covers that window instead:
 *   - Chromium-stack traffic (renderer, main-process `net`) is blocked from
 *     process start by `--host-resolver-rules`, which has no window at all;
 *   - the only startup Node `fetch` in the app, the update check, returns
 *     early on `!app.isPackaged`, and the capture always runs unpackaged.
 */

import type { ElectronApplication } from '@playwright/test';

type NetworkPolicy = {
    schemes: string[];
    hosts: string[];
    protocols: string[];
    stubPrefixes: string[];
};

/**
 * Records and blocks at the Electron session level, from before the renderer
 * boots. Blocking here as well as in the page route matters because
 * `page.route` only covers renderer traffic: anything the main process fetches
 * (updater, telemetry, a future feature) would otherwise reach the network and
 * only be reported afterwards — too late to be a fail-closed boundary.
 *
 * Stubbed URLs are allowed through so the page-level route can fulfill them
 * locally; every other non-local URL is cancelled outright.
 */
export async function installRequestRecorder(
    app: ElectronApplication,
    policy: NetworkPolicy
): Promise<void> {
    // The body is serialized into the Electron main process, where esbuild's
    // `__name` helper does not exist — so it must contain no *named* inner
    // function (`const isLocal = …` or `function isLocal()`), only anonymous
    // callbacks. A named one throws `__name is not defined` at install time.
    await app.evaluate(({ session }, appliedPolicy) => {
        const store: string[] = [];
        const scope = globalThis as unknown as {
            __captureRequests: string[];
            __captureIsLocal: (url: string) => boolean;
            fetch: typeof fetch;
        };

        scope.__captureRequests = store;

        // Assigned to a member expression on purpose: esbuild's keepNames
        // wraps functions bound to an identifier with a `__name` helper that
        // does not exist in this serialized context.
        scope.__captureIsLocal = (url: string) => {
            if (appliedPolicy.stubPrefixes.some((p) => url.startsWith(p))) {
                return true;
            }

            try {
                const parsed = new URL(url);

                return (
                    appliedPolicy.schemes.includes(parsed.protocol) ||
                    (appliedPolicy.protocols.includes(parsed.protocol) &&
                        appliedPolicy.hosts.includes(parsed.hostname))
                );
            } catch {
                return appliedPolicy.schemes.some((s) => url.startsWith(s));
            }
        };

        session.defaultSession.webRequest.onBeforeRequest(
            (details, callback) => {
                store.push(details.url);
                callback({ cancel: !scope.__captureIsLocal(details.url) });
            }
        );

        // Chromium's network stack — and therefore both the resolver switch
        // and the webRequest hook — never sees main-process `fetch`, which
        // runs on Node's stack. The app update service uses exactly that, so
        // wrap it: record every URL and reject non-local ones outright.
        const originalFetch = scope.fetch;

        scope.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
            const url =
                typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.href
                      : input.url;

            store.push(url);

            if (!scope.__captureIsLocal(url)) {
                return Promise.reject(
                    new Error(`capture network gate blocked ${url}`)
                );
            }

            return originalFetch(input, init);
        };
    }, policy);
}

export async function drainRecordedRequests(
    app: ElectronApplication
): Promise<string[]> {
    return app.evaluate(
        () =>
            (globalThis as unknown as { __captureRequests?: string[] })
                .__captureRequests ?? []
    );
}
