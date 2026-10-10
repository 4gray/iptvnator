import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';

/**
 * Routine portal outcomes must not reach the main-process log as errors.
 *
 * Electron prints `Error occurred in handler for '<channel>'` — with a stack
 * trace — for every `ipcMain.handle` promise that rejects. A request the
 * renderer cancelled (navigation, a superseded or expired probe) and an HTTP
 * 401/403 (the portal answered and refused) are expected, so both portal
 * handlers resolve them as a `portalRequestFailure` envelope instead: the
 * renderer's data service rethrows it (`portal-request-failure.util.ts`), the
 * refusal is one credential-free warning, and the cancellation is silent.
 */

const MAC_ADDRESS = '00:1A:79:00:00:31';
const USERNAME = 'probe-user-31';
const PASSWORD = 'probe-secret-31';
const HANDLER_FAILURE = 'Error occurred in handler for';
/** Electron colours its console output; the assertions read plain text. */
const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

type Probe = { requestId: string; deadlineAt: number };

/** A portal that answers every request with 401, like an HTTP auth gate. */
async function startRefusingPortal(): Promise<{
    origin: string;
    close: () => Promise<void>;
}> {
    const server = createServer((_request, response) => {
        response.writeHead(401, {
            'content-type': 'text/plain',
            'www-authenticate': 'Basic realm="portal"',
        });
        response.end('Unauthorized');
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    return {
        origin: `http://127.0.0.1:${port}`,
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            ),
    };
}

test('@stalker @xtream @electron resolves cancelled and refused portal requests without logging handler errors', async ({
    dataDir,
}) => {
    const portal = await startRefusingPortal();
    try {
        await runAgainstRefusingPortal(dataDir, portal.origin);
    } finally {
        await portal.close();
    }
});

async function runAgainstRefusingPortal(
    dataDir: string,
    origin: string
): Promise<void> {
    // A developer shell with the IPC trace on would make the handlers log
    // the cancellations on purpose; this test asserts the default silence.
    const app = await launchElectronApp(dataDir, {
        omitEnvKeys: ['IPTVNATOR_TRACE_IPC', 'IPTVNATOR_TRACE_STARTUP'],
    });
    let diagnostics = '';
    const capture = (chunk: Buffer) => {
        diagnostics += chunk.toString().replace(ANSI_SEQUENCE, '');
    };
    const electronProcess = app.electronApp.process();
    electronProcess.stdout?.on('data', capture);
    electronProcess.stderr?.on('data', capture);
    try {
        const outcomes = await app.mainWindow.evaluate(
            async ({ origin, macAddress, username, password }) => {
                // A probe whose deadline already passed is aborted before the
                // request leaves the main process: a deterministic cancel.
                const expired = (requestId: string): Probe => ({
                    requestId,
                    deadlineAt: Date.now(),
                });
                const stalker = (probe?: Probe) =>
                    window.electron.stalkerRequest({
                        url: `${origin}/portal.php`,
                        macAddress,
                        params: { type: 'stb', action: 'handshake' },
                        ...(probe ? { probe } : {}),
                    });
                const xtream = (probe?: Probe) =>
                    window.electron.xtreamRequest({
                        url: origin,
                        params: {
                            username,
                            password,
                            action: 'get_account_info',
                        },
                        ...(probe ? { probe } : {}),
                    });
                return {
                    stalkerCancelled: await stalker(expired('stalker-cancel')),
                    xtreamCancelled: await xtream(expired('xtream-cancel')),
                    stalkerRefused: await stalker(),
                    xtreamRefused: await xtream(),
                };
            },
            {
                origin,
                macAddress: MAC_ADDRESS,
                username: USERNAME,
                password: PASSWORD,
            }
        );

        // Resolved, structured, and never shaped like an answer.
        const cancelled = { portalRequestFailure: { kind: 'cancelled' } };
        const refused = {
            portalRequestFailure: {
                kind: 'http',
                status: 401,
                statusText: 'Unauthorized',
            },
        };
        expect(outcomes.stalkerCancelled).toEqual(cancelled);
        expect(outcomes.xtreamCancelled).toEqual(cancelled);
        expect(outcomes.stalkerRefused).toEqual(refused);
        expect(outcomes.xtreamRefused).toEqual(refused);

        // One warning per refusal; the cancellations stay silent; Electron
        // never saw a rejected handler.
        await expect
            .poll(
                () =>
                    diagnostics.match(/\[(?:STALKER|XTREAM)_REQUEST\] Refused/g)
                        ?.length ?? 0
            )
            .toBe(2);
        expect(diagnostics).toContain('[STALKER_REQUEST] Refused');
        expect(diagnostics).toContain('[XTREAM_REQUEST] Refused');
        expect(diagnostics).not.toContain(HANDLER_FAILURE);
        expect(diagnostics).not.toMatch(
            /\[(?:STALKER|XTREAM)_REQUEST\] (?:Failed|cancelled)/
        );

        // Host and pathname only: no MAC, no credentials, no query string.
        expect(diagnostics).toContain("pathname: '/portal.php'");
        expect(diagnostics).toContain("pathname: '/player_api.php'");
        expect(diagnostics).not.toContain(MAC_ADDRESS);
        expect(diagnostics).not.toContain(USERNAME);
        expect(diagnostics).not.toContain(PASSWORD);
        expect(diagnostics).not.toMatch(/portal\.php\?|player_api\.php\?/);
    } finally {
        electronProcess.stdout?.off('data', capture);
        electronProcess.stderr?.off('data', capture);
        await closeElectronApp(app);
    }
}
