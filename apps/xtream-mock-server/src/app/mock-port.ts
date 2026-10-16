/** Port the Xtream mock listens on when nothing in the environment says otherwise. */
export const DEFAULT_XTREAM_MOCK_PORT = 3211;

/**
 * The one place the mock's port is read from the environment: `PORT` (the
 * server's own knob) first, then `XTREAM_MOCK_PORT` — the client-side alias
 * Playwright and the specs read, honoured so one variable relocates the whole
 * E2E run — then the default. Returned as the raw string so the caller
 * decides how strictly to validate it.
 *
 * Both the listener (`parseXtreamMockServerEnvironment`) and the marketing
 * fixture's asset origin (`marketingAssetUrl`) go through this, because the
 * poster/backdrop/logo/episode URLs the fixture mints must point at the port
 * the server actually bound — a fixture that read `PORT` alone sent every
 * `XTREAM_MOCK_PORT`-relocated run's images to 3211.
 */
export function resolveXtreamMockPortString(
    environment: NodeJS.ProcessEnv
): string {
    return (
        environment['PORT'] ??
        environment['XTREAM_MOCK_PORT'] ??
        String(DEFAULT_XTREAM_MOCK_PORT)
    );
}
