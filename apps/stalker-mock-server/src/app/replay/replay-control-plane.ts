/* eslint-disable max-lines -- Keep the loopback control-plane validation and lifecycle in one auditable boundary. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import http, {
    IncomingMessage,
    Server,
    ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { REPLAY_MAX_FIXTURE_BYTES } from './replay.constants.js';
import {
    createReplayServerRun,
    ReplayServerRun,
} from './replay-server.js';
import {
    parseReplayFixture,
    parseReplayFixtureText,
    ReplaySchemaError,
} from './replay-schema.js';
import { ReplayFixtureV1 } from './replay.types.js';

const LOOPBACK_ADDRESS = '127.0.0.1';
const CREATE_PATH = '/v1/replay/create';
const FINALIZE_PATH = '/v1/replay/finalize';
const DISPOSE_PATH = '/v1/replay/dispose';
const SAFE_FIXTURE_ID =
    /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63}){0,7}$/;
const SAFE_RUN_ID = /^run-[a-f0-9]{32}$/;
const DEFAULT_REQUEST_BODY_TIMEOUT_MS = 5000;

export const REPLAY_CONTROL_CAPABILITY_HEADER =
    'x-iptvnator-replay-capability';
export const REPLAY_CONTROL_MAX_BODY_BYTES = 64 * 1024;

const CONTROL_ERROR_CODE = {
    BODY_TOO_LARGE: 'control-body-too-large',
    BODY_TIMEOUT: 'control-body-timeout',
    ENDPOINT_NOT_FOUND: 'endpoint-not-found',
    FIXTURE_INVALID: 'fixture-invalid',
    FIXTURE_NOT_ALLOWED: 'fixture-not-allowed',
    INTERNAL: 'control-internal-error',
    INVALID_CAPABILITY: 'invalid-capability',
    INVALID_HOST: 'invalid-host',
    INVALID_JSON: 'invalid-json',
    INVALID_REQUEST: 'invalid-request',
    JSON_REQUIRED: 'json-required',
    METHOD_NOT_ALLOWED: 'method-not-allowed',
    RUN_NOT_FOUND: 'run-not-found',
} as const;

type ReplayControlErrorCode =
    (typeof CONTROL_ERROR_CODE)[keyof typeof CONTROL_ERROR_CODE];

class ReplayControlError extends Error {
    constructor(
        readonly code: ReplayControlErrorCode,
        readonly status: number
    ) {
        super(`Replay control request rejected: ${code}.`);
        this.name = 'ReplayControlError';
    }
}

export type ReplayFixtureRepositoryErrorCode =
    | 'fixture-not-allowed'
    | 'fixture-invalid';

export class ReplayFixtureRepositoryError extends Error {
    constructor(readonly code: ReplayFixtureRepositoryErrorCode) {
        super(`Replay fixture repository rejected: ${code}.`);
        this.name = 'ReplayFixtureRepositoryError';
    }
}

export interface ReplayFixtureRepository {
    loadFixture(fixtureId: string): Promise<ReplayFixtureV1>;
}

function assertSafeFixtureId(fixtureId: string): void {
    if (!SAFE_FIXTURE_ID.test(fixtureId)) {
        throw new ReplayFixtureRepositoryError('fixture-not-allowed');
    }
}

export class InMemoryReplayFixtureRepository
    implements ReplayFixtureRepository
{
    private readonly fixtures: Readonly<Record<string, unknown>>;

    constructor(fixtures: Readonly<Record<string, unknown>>) {
        this.fixtures = Object.freeze({ ...fixtures });
    }

    async loadFixture(fixtureId: string): Promise<ReplayFixtureV1> {
        assertSafeFixtureId(fixtureId);
        if (!Object.prototype.hasOwnProperty.call(this.fixtures, fixtureId)) {
            throw new ReplayFixtureRepositoryError('fixture-not-allowed');
        }
        try {
            return parseReplayFixture(this.fixtures[fixtureId]);
        } catch (error) {
            if (error instanceof ReplaySchemaError) {
                throw new ReplayFixtureRepositoryError('fixture-invalid');
            }
            throw error;
        }
    }
}

function isWithinRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative.length > 0 &&
        !relative.startsWith(`..${path.sep}`) &&
        relative !== '..' &&
        !path.isAbsolute(relative)
    );
}

async function readBoundedFixture(handle: FileHandle): Promise<string> {
    const chunks: Buffer[] = [];
    const readBuffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (true) {
        const { bytesRead } = await handle.read(
            readBuffer,
            0,
            readBuffer.byteLength,
            position
        );
        if (bytesRead === 0) {
            break;
        }
        position += bytesRead;
        if (position > REPLAY_MAX_FIXTURE_BYTES) {
            throw new ReplayFixtureRepositoryError(
                'fixture-not-allowed'
            );
        }
        chunks.push(Buffer.from(readBuffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks).toString('utf8');
}

export class RepositoryReplayFixtureRepository
    implements ReplayFixtureRepository
{
    constructor(private readonly repositoryRoot: string) {}

    async loadFixture(fixtureId: string): Promise<ReplayFixtureV1> {
        assertSafeFixtureId(fixtureId);
        try {
            const root = await realpath(this.repositoryRoot);
            const requestedPath = path.join(
                root,
                ...fixtureId.split('/')
            ).concat('.json');
            const requestedStats = await lstat(requestedPath);
            if (
                requestedStats.isSymbolicLink() ||
                !requestedStats.isFile()
            ) {
                throw new ReplayFixtureRepositoryError(
                    'fixture-not-allowed'
                );
            }
            const resolvedPath = await realpath(requestedPath);
            if (!isWithinRoot(root, resolvedPath)) {
                throw new ReplayFixtureRepositoryError(
                    'fixture-not-allowed'
                );
            }

            const handle = await open(
                requestedPath,
                fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
            );
            try {
                const stats = await handle.stat();
                if (
                    !stats.isFile() ||
                    stats.size > REPLAY_MAX_FIXTURE_BYTES ||
                    stats.dev !== requestedStats.dev ||
                    stats.ino !== requestedStats.ino
                ) {
                    throw new ReplayFixtureRepositoryError(
                        'fixture-not-allowed'
                    );
                }
                const text = await readBoundedFixture(handle);
                return parseReplayFixtureText(text);
            } finally {
                await handle.close();
            }
        } catch (error) {
            if (error instanceof ReplayFixtureRepositoryError) {
                throw error;
            }
            if (error instanceof ReplaySchemaError) {
                throw new ReplayFixtureRepositoryError('fixture-invalid');
            }
            throw new ReplayFixtureRepositoryError('fixture-not-allowed');
        }
    }
}

export function createRepositoryReplayFixtureRepository(): ReplayFixtureRepository {
    return new RepositoryReplayFixtureRepository(
        path.resolve(
            process.cwd(),
            'apps/stalker-mock-server/fixtures/replay'
        )
    );
}

export function createReplayControlPlaneCapability(): string {
    return randomBytes(32).toString('base64url');
}

function capabilityMatches(actual: string | undefined, expected: string): boolean {
    if (actual === undefined) {
        return false;
    }
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    return (
        actualBytes.byteLength === expectedBytes.byteLength &&
        timingSafeEqual(actualBytes, expectedBytes)
    );
}

function sendJson(
    response: ServerResponse,
    status: number,
    value: unknown
): void {
    const body = Buffer.from(JSON.stringify(value));
    response.writeHead(status, {
        'content-type': 'application/json',
        'content-length': String(body.byteLength),
        'cache-control': 'no-store',
        connection: 'close',
    });
    response.end(body);
}

function sendControlError(
    response: ServerResponse,
    error: ReplayControlError
): void {
    sendJson(response, error.status, { error: { code: error.code } });
}

function requestPath(request: IncomingMessage): string {
    if (request.url === undefined) {
        throw new ReplayControlError(
            CONTROL_ERROR_CODE.ENDPOINT_NOT_FOUND,
            404
        );
    }
    const url = new URL(request.url, 'http://control.invalid');
    if (url.search.length > 0) {
        throw new ReplayControlError(
            CONTROL_ERROR_CODE.ENDPOINT_NOT_FOUND,
            404
        );
    }
    return url.pathname;
}

function contentType(request: IncomingMessage): string {
    const header = request.headers['content-type'];
    const value = Array.isArray(header) ? header[0] : header;
    return (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function readControlBody(
    request: IncomingMessage,
    timeoutMs: number
): Promise<Buffer> {
    const declaredLength = request.headers['content-length'];
    if (
        declaredLength !== undefined &&
        (!/^\d+$/.test(declaredLength) ||
            Number(declaredLength) > REPLAY_CONTROL_MAX_BODY_BYTES)
    ) {
        request.resume();
        throw new ReplayControlError(
            CONTROL_ERROR_CODE.BODY_TOO_LARGE,
            413
        );
    }

    return new Promise<Buffer>((resolve, reject) => {
        let total = 0;
        const chunks: Buffer[] = [];
        let settled = false;
        const cleanup = () => {
            clearTimeout(timer);
            request.off('data', onData);
            request.off('end', onEnd);
            request.off('aborted', onAborted);
            request.off('error', onError);
        };
        const rejectOnce = (error: ReplayControlError) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            request.resume();
            reject(error);
        };
        const onData = (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
            total += buffer.byteLength;
            if (total > REPLAY_CONTROL_MAX_BODY_BYTES) {
                rejectOnce(
                    new ReplayControlError(
                        CONTROL_ERROR_CODE.BODY_TOO_LARGE,
                        413
                    )
                );
                return;
            }
            chunks.push(buffer);
        };
        const onEnd = () => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(Buffer.concat(chunks));
        };
        const onAborted = () =>
            rejectOnce(
                new ReplayControlError(
                    CONTROL_ERROR_CODE.INVALID_REQUEST,
                    400
                )
            );
        const onError = () => onAborted();
        const timer = setTimeout(
            () =>
                rejectOnce(
                    new ReplayControlError(
                        CONTROL_ERROR_CODE.BODY_TIMEOUT,
                        408
                    )
                ),
            timeoutMs
        );
        timer.unref();
        request.on('data', onData);
        request.once('end', onEnd);
        request.once('aborted', onAborted);
        request.once('error', onError);
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null)
    );
}

async function parseJsonBody(
    request: IncomingMessage,
    requestBodyTimeoutMs: number
): Promise<Record<string, unknown>> {
    if (contentType(request) !== 'application/json') {
        throw new ReplayControlError(
            CONTROL_ERROR_CODE.JSON_REQUIRED,
            415
        );
    }
    const rawBody = await readControlBody(
        request,
        requestBodyTimeoutMs
    );
    try {
        const value: unknown = JSON.parse(rawBody.toString('utf8'));
        if (!isRecord(value)) {
            throw new ReplayControlError(
                CONTROL_ERROR_CODE.INVALID_REQUEST,
                400
            );
        }
        return value;
    } catch (error) {
        if (error instanceof ReplayControlError) {
            throw error;
        }
        throw new ReplayControlError(CONTROL_ERROR_CODE.INVALID_JSON, 400);
    }
}

function hasExactKeys(
    value: Record<string, unknown>,
    keys: readonly string[]
): boolean {
    return (
        Object.keys(value).length === keys.length &&
        keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    );
}

function readFixtureId(body: Record<string, unknown>): string {
    if (
        !hasExactKeys(body, ['fixtureId']) ||
        typeof body['fixtureId'] !== 'string' ||
        !SAFE_FIXTURE_ID.test(body['fixtureId'])
    ) {
        throw new ReplayControlError(
            CONTROL_ERROR_CODE.FIXTURE_NOT_ALLOWED,
            404
        );
    }
    return body['fixtureId'];
}

function readRunId(body: Record<string, unknown>): string {
    if (
        !hasExactKeys(body, ['runId']) ||
        typeof body['runId'] !== 'string' ||
        !SAFE_RUN_ID.test(body['runId'])
    ) {
        throw new ReplayControlError(
            CONTROL_ERROR_CODE.RUN_NOT_FOUND,
            404
        );
    }
    return body['runId'];
}

async function closeServer(server: Server): Promise<void> {
    if (!server.listening) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        server.close((error) =>
            error === undefined ? resolve() : reject(error)
        );
    });
}

async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
            server.off('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.off('error', onError);
            resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, LOOPBACK_ADDRESS);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Replay control listener has no TCP address.');
    }
    return (address as AddressInfo).port;
}

export interface StartReplayControlPlaneOptions {
    capability?: string;
    repository?: ReplayFixtureRepository;
    requestBodyTimeoutMs?: number;
}

export interface ReplayControlPlane {
    readonly url: string;
    close(): Promise<void>;
}

export async function startReplayControlPlane(
    options: StartReplayControlPlaneOptions = {}
): Promise<ReplayControlPlane> {
    const capability =
        options.capability ?? createReplayControlPlaneCapability();
    const repository =
        options.repository ?? createRepositoryReplayFixtureRepository();
    const requestBodyTimeoutMs =
        options.requestBodyTimeoutMs ?? DEFAULT_REQUEST_BODY_TIMEOUT_MS;
    if (
        !Number.isInteger(requestBodyTimeoutMs) ||
        requestBodyTimeoutMs <= 0
    ) {
        throw new Error('Replay control body timeout must be positive.');
    }
    const runs = new Map<string, ReplayServerRun>();
    let expectedHost = '';

    const server = http.createServer(async (request, response) => {
        try {
            if (request.headers.host !== expectedHost) {
                throw new ReplayControlError(
                    CONTROL_ERROR_CODE.INVALID_HOST,
                    400
                );
            }
            const capabilityHeader =
                request.headers[REPLAY_CONTROL_CAPABILITY_HEADER];
            if (
                Array.isArray(capabilityHeader) ||
                !capabilityMatches(capabilityHeader, capability)
            ) {
                throw new ReplayControlError(
                    CONTROL_ERROR_CODE.INVALID_CAPABILITY,
                    403
                );
            }
            const actionPath = requestPath(request);
            if (
                actionPath !== CREATE_PATH &&
                actionPath !== FINALIZE_PATH &&
                actionPath !== DISPOSE_PATH
            ) {
                throw new ReplayControlError(
                    CONTROL_ERROR_CODE.ENDPOINT_NOT_FOUND,
                    404
                );
            }
            if (request.method !== 'POST') {
                throw new ReplayControlError(
                    CONTROL_ERROR_CODE.METHOD_NOT_ALLOWED,
                    405
                );
            }
            const body = await parseJsonBody(
                request,
                requestBodyTimeoutMs
            );

            if (actionPath === CREATE_PATH) {
                const fixtureId = readFixtureId(body);
                let fixture: ReplayFixtureV1;
                try {
                    fixture = await repository.loadFixture(fixtureId);
                } catch (error) {
                    if (
                        error instanceof ReplayFixtureRepositoryError &&
                        error.code === 'fixture-not-allowed'
                    ) {
                        throw new ReplayControlError(
                            CONTROL_ERROR_CODE.FIXTURE_NOT_ALLOWED,
                            404
                        );
                    }
                    if (
                        error instanceof ReplayFixtureRepositoryError &&
                        error.code === 'fixture-invalid'
                    ) {
                        throw new ReplayControlError(
                            CONTROL_ERROR_CODE.FIXTURE_INVALID,
                            422
                        );
                    }
                    throw error;
                }
                const run = await createReplayServerRun(fixture);
                if (runs.has(run.runId)) {
                    await run.dispose();
                    throw new ReplayControlError(
                        CONTROL_ERROR_CODE.INTERNAL,
                        500
                    );
                }
                runs.set(run.runId, run);
                sendJson(response, 201, {
                    runId: run.runId,
                    entryUrl: run.entryUrl,
                    origins: run.originUrls,
                    inputs: run.generatedInputs,
                });
                return;
            }

            const runId = readRunId(body);
            const run = runs.get(runId);
            if (run === undefined) {
                throw new ReplayControlError(
                    CONTROL_ERROR_CODE.RUN_NOT_FOUND,
                    404
                );
            }
            if (actionPath === FINALIZE_PATH) {
                sendJson(response, 200, run.finalize());
                return;
            }

            await run.dispose();
            runs.delete(runId);
            sendJson(response, 200, { disposed: true });
        } catch (error) {
            if (!request.complete) {
                request.resume();
            }
            if (error instanceof ReplayControlError) {
                sendControlError(response, error);
            } else {
                sendControlError(
                    response,
                    new ReplayControlError(CONTROL_ERROR_CODE.INTERNAL, 500)
                );
            }
        }
    });

    const port = await listen(server);
    expectedHost = `${LOOPBACK_ADDRESS}:${port}`;
    const url = `http://${expectedHost}`;
    let closePromise: Promise<void> | undefined;
    return {
        url,
        close: () => {
            closePromise ??= (async () => {
                await Promise.all(
                    [...runs.values()].map((run) => run.dispose())
                );
                runs.clear();
                await closeServer(server);
            })();
            return closePromise;
        },
    };
}
