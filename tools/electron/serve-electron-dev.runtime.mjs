import { request } from 'node:http';
import { createServer } from 'node:net';

const STARTUP_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const MAX_RESPONSE_BYTES = 128 * 1024;
const SIGNAL_EXIT_CODES = {
    SIGINT: 130,
    SIGTERM: 143,
};

export async function assertPortAvailable(port, probe = listenOnce) {
    const results = await Promise.all(
        ['127.0.0.1', '::1'].map(async (host) => {
            try {
                await probe(host, port);
                return true;
            } catch (error) {
                if (
                    error.code === 'EADDRNOTAVAIL' ||
                    error.code === 'EAFNOSUPPORT'
                ) {
                    return false;
                }
                throw error;
            }
        })
    );
    if (!results.some(Boolean)) {
        throw new Error('No localhost network family is available.');
    }
}

export function isIptvnatorWebResponse(statusCode, contentType, body) {
    return (
        statusCode >= 200 &&
        statusCode < 300 &&
        contentType.toLowerCase().includes('text/html') &&
        body.includes('<title>IPTVnator</title>') &&
        body.includes('<app-root')
    );
}

export async function waitForIptvnatorWebServer(url, webChild, options = {}) {
    const timeoutMs = options.timeoutMs ?? STARTUP_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    const requestPage = options.requestPage ?? requestWebPage;
    const deadline = Date.now() + timeoutMs;

    let rejectForExit;
    let rejectForError;
    const failedChild = new Promise((_, reject) => {
        rejectForExit = (code, signal) => {
            reject(
                new Error(
                    `Web development server exited before readiness (${formatExit(
                        code,
                        signal
                    )}).`
                )
            );
        };
        rejectForError = (error) => reject(error);
        webChild.once('exit', rejectForExit);
        webChild.once('error', rejectForError);
    });

    try {
        await Promise.race([
            pollUntilReady(
                url,
                deadline,
                timeoutMs,
                pollIntervalMs,
                requestPage
            ),
            failedChild,
        ]);
    } finally {
        webChild.off('exit', rejectForExit);
        webChild.off('error', rejectForError);
    }
}

export function coordinateChildProcesses(
    webChild,
    electronChild,
    processRef = process
) {
    let stopping = false;
    const signalHandlers = new Map();

    const stop = (exitCode, signal = 'SIGTERM') => {
        if (stopping) return;
        stopping = true;
        for (const [name, handler] of signalHandlers) {
            processRef.off(name, handler);
        }
        terminate(webChild, signal);
        terminate(electronChild, signal);
        processRef.exitCode = exitCode;
    };

    for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
        const handler = () => stop(SIGNAL_EXIT_CODES[signal], signal);
        signalHandlers.set(signal, handler);
        processRef.on(signal, handler);
    }

    webChild.once('error', () => stop(1));
    electronChild.once('error', () => stop(1));
    webChild.once('exit', (code, signal) =>
        stop(toExitCode(code, signal), signal ?? 'SIGTERM')
    );
    electronChild.once('exit', (code, signal) =>
        stop(toExitCode(code, signal), signal ?? 'SIGTERM')
    );

    return { stop };
}

async function pollUntilReady(
    url,
    deadline,
    timeoutMs,
    pollIntervalMs,
    requestPage
) {
    while (Date.now() < deadline) {
        try {
            const response = await requestPage(url);
            if (
                isIptvnatorWebResponse(
                    response.statusCode,
                    response.contentType,
                    response.body
                )
            ) {
                return;
            }
        } catch {
            // The owned development server is still starting.
        }
        await delay(pollIntervalMs);
    }
    throw new Error(
        `IPTVnator web development server did not become ready within ${timeoutMs} ms.`
    );
}

function requestWebPage(url) {
    return new Promise((resolve, reject) => {
        const req = request(url, { method: 'GET' }, (response) => {
            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size > MAX_RESPONSE_BYTES) {
                    req.destroy(
                        new Error('Web readiness response exceeded size limit.')
                    );
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode ?? 0,
                    contentType: String(response.headers['content-type'] ?? ''),
                    body: Buffer.concat(chunks).toString('utf8'),
                });
            });
        });
        req.setTimeout(2_000, () => {
            req.destroy(new Error('Web readiness request timed out.'));
        });
        req.on('error', reject);
        req.end();
    });
}

function listenOnce(host, port) {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.once('error', (error) => {
            const wrapped = new Error(
                `Cannot start IPTVnator: ${host}:${port} is unavailable (${error.code}).`
            );
            wrapped.code = error.code;
            reject(wrapped);
        });
        server.listen({ host, port, exclusive: true }, () => {
            server.close(resolve);
        });
    });
}

function terminate(child, signal) {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
    }
}

function toExitCode(code, signal) {
    if (typeof code === 'number') return code;
    return SIGNAL_EXIT_CODES[signal] ?? 1;
}

function formatExit(code, signal) {
    return signal ? `signal ${signal}` : `code ${code ?? 1}`;
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
