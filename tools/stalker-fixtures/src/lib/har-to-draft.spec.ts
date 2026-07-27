/* eslint-disable max-lines -- Keep the representative capture and its fail-closed conversion cases together. */
import { validateReplayFixtureText } from './fixture-validator';
import {
    HAR_TO_DRAFT_ERROR_CODES,
    HarToDraftError,
    convertHarToReplayDraft,
} from './har-to-draft';
import { HAR_READER_ERROR_CODES, HarReaderError } from './har-reader';

const CAPTURED = {
    portalOrigin: 'https://portal.vendor.private:8443',
    edgeOrigin: 'https://edge.vendor.private:9443',
    mac: '00:1A:79:12:34:56',
    token: 'eyJhbGciOiJIUzI1NiJ9.privatePayload.privateSignature',
    username: 'customer@example.invalid',
    password: 'not-a-real-password',
    cookie: 'captured-cookie-session-value',
    serial: 'captured-serial-0001',
    device: 'captured-device-0002',
    signature: 'captured-signature-0003',
    futureCredential: 'short-future-secret',
} as const;

function representativeHar(): unknown {
    const responseJson = {
        js: {
            token: CAPTURED.token,
            mac: CAPTURED.mac,
            username: CAPTURED.username,
            password: CAPTURED.password,
            serial: CAPTURED.serial,
            device_id: CAPTURED.device,
            signature: CAPTURED.signature,
            harmless_alias: CAPTURED.futureCredential,
            harmless_message: `prefix ${CAPTURED.futureCredential} suffix`,
            provider: 'captured-provider-name',
            stream_url: `${CAPTURED.edgeOrigin}/play/private-stream`,
            received_at: '2026-07-27T12:34:56.000Z',
            safe_flag: true,
        },
    };

    return {
        log: {
            version: '1.2',
            creator: { name: 'browser', version: '1' },
            entries: [
                {
                    startedDateTime: '2026-07-27T12:34:56.000Z',
                    request: {
                        method: 'POST',
                        url:
                            `${CAPTURED.portalOrigin}/c/portal.php` +
                            `?type=stb&action=handshake&mac=${encodeURIComponent(CAPTURED.mac)}`,
                        headers: [
                            { name: 'Accept', value: 'application/json' },
                            {
                                name: 'Content-Type',
                                value: 'application/x-www-form-urlencoded',
                            },
                            {
                                name: 'Authorization',
                                value: `Bearer ${CAPTURED.token}`,
                            },
                            {
                                name: 'Cookie',
                                value:
                                    `mac=${CAPTURED.mac}; ` +
                                    `PHPSESSID=${CAPTURED.cookie}`,
                            },
                            {
                                name: 'X-Ignored-Capture-Header',
                                value: CAPTURED.serial,
                            },
                        ],
                        cookies: [
                            { name: 'mac', value: CAPTURED.mac },
                            {
                                name: 'PHPSESSID',
                                value: CAPTURED.cookie,
                            },
                        ],
                        postData: {
                            mimeType: 'application/x-www-form-urlencoded',
                            text:
                                `username=${encodeURIComponent(CAPTURED.username)}` +
                                `&password=${encodeURIComponent(CAPTURED.password)}`,
                        },
                    },
                    response: {
                        status: 302,
                        headers: [
                            {
                                name: 'Content-Type',
                                value: 'application/json; charset=utf-8',
                            },
                            {
                                name: 'Location',
                                value:
                                    `${CAPTURED.edgeOrigin}/load.php` +
                                    `?token=${encodeURIComponent(CAPTURED.token)}`,
                            },
                            {
                                name: 'Set-Cookie',
                                value:
                                    `PHPSESSID=${CAPTURED.cookie}; ` +
                                    'Path=/c/; HttpOnly; Secure; SameSite=Lax; ' +
                                    'Expires=Mon, 27 Jul 2026 12:34:56 GMT',
                            },
                        ],
                        cookies: [],
                        content: {
                            mimeType: 'application/json',
                            text: JSON.stringify(responseJson),
                        },
                    },
                },
                {
                    request: {
                        method: 'GET',
                        url:
                            `${CAPTURED.edgeOrigin}/load.php` +
                            `?token=${encodeURIComponent(CAPTURED.token)}` +
                            `&password=${encodeURIComponent(CAPTURED.futureCredential)}`,
                        headers: [
                            {
                                name: 'Accept',
                                value: 'application/octet-stream',
                            },
                        ],
                        cookies: [],
                    },
                    response: {
                        status: 200,
                        headers: [
                            {
                                name: 'Content-Type',
                                value: 'application/octet-stream',
                            },
                        ],
                        cookies: [],
                        content: {
                            mimeType: 'application/octet-stream',
                            encoding: 'base64',
                            text: Buffer.from([0, 1, 2, 3]).toString('base64'),
                        },
                    },
                },
            ],
        },
    };
}

function expectDraftCode(operation: () => unknown, code: string): void {
    try {
        operation();
        throw new Error('HAR conversion unexpectedly passed');
    } catch (error) {
        expect(error).toBeInstanceOf(HarToDraftError);
        expect((error as HarToDraftError).code).toBe(code);
        expect((error as Error).message).toBe(
            `Stalker HAR conversion failed: ${code}.`
        );
    }
}

describe('HAR to replay draft conversion', () => {
    it('preserves protocol shape while replacing captured identity with typed symbols', () => {
        const draft = convertHarToReplayDraft(representativeHar());

        expect(() => validateReplayFixtureText(draft.formatted)).not.toThrow();
        expect(Object.keys(draft.fixture.origins)).toEqual([
            'origin-1',
            'origin-2',
        ]);
        expect(draft.fixture.entry).toEqual({
            origin: 'origin-1',
            path: '/c/portal.php',
        });
        expect(draft.fixture.expectedEndpoint).toEqual({
            origin: 'origin-2',
            path: '/load.php',
        });
        expect(draft.fixture.phases).toHaveLength(2);
        expect(draft.fixture.phases[0]?.expectations[0]?.response.status).toBe(
            302
        );
        expect(
            draft.fixture.phases[0]?.expectations[0]?.response.headers[
                'location'
            ]?.[0]
        ).toMatchObject({
            kind: 'origin-url',
            origin: 'origin-2',
            path: '/load.php',
        });
        expect(draft.fixture.phases[1]?.expectations[0]?.response.body).toEqual(
            {
                kind: 'generated',
                byteLength: 4,
                byte: 0,
            }
        );

        const valueKinds = new Set(
            draft.fixture.symbols.map((symbol) => symbol.valueKind)
        );
        expect(valueKinds).toEqual(
            new Set(['mac', 'credential', 'token', 'cookie', 'random'])
        );
        expect(draft.formatted).toContain('"kind": "ref"');
        expect(draft.formatted).toContain('"kind": "parts"');

        for (const literal of Object.values(CAPTURED)) {
            expect(draft.formatted).not.toContain(literal);
            expect(draft.formatted).not.toContain(encodeURIComponent(literal));
        }
        expect(draft.formatted).not.toContain('captured-provider-name');
        expect(draft.formatted).not.toContain('private-stream');
        expect(draft.formatted).not.toContain('2026-07-27');
        expect(draft.formatted).not.toContain('X-Ignored-Capture-Header');
    });

    it('uses one symbol for the same correlation across phases', () => {
        const draft = convertHarToReplayDraft(representativeHar());
        const serialized = draft.formatted;
        const tokenDeclarations = draft.fixture.symbols.filter(
            (symbol) => symbol.valueKind === 'token'
        );

        expect(tokenDeclarations).toHaveLength(1);
        const tokenSymbol = tokenDeclarations[0]?.symbol;
        expect(tokenSymbol).toBeDefined();
        expect(
            serialized.split(`"symbol": "${tokenSymbol}"`).length - 1
        ).toBeGreaterThanOrEqual(4);
    });

    it('rejects redirects to an origin absent from captured requests', () => {
        const har = representativeHar() as {
            log: {
                entries: Array<{
                    response: {
                        headers: Array<{ name: string; value: string }>;
                    };
                }>;
            };
        };
        const location = har.log.entries[0]?.response.headers.find(
            (header) => header.name === 'Location'
        );
        if (location === undefined) {
            throw new Error('test HAR is missing Location');
        }
        location.value = 'https://unseen.external.invalid/portal.php';

        expectDraftCode(
            () => convertHarToReplayDraft(har),
            HAR_TO_DRAFT_ERROR_CODES.UnknownExternalOrigin
        );
    });

    it('resolves relative redirects against the captured request origin', () => {
        const har = representativeHar() as {
            log: {
                entries: Array<{
                    response: {
                        headers: Array<{ name: string; value: string }>;
                    };
                }>;
            };
        };
        const location = requiredEntry(
            har.log.entries,
            0
        ).response.headers.find((header) => header.name === 'Location');
        if (location === undefined) {
            throw new Error('test HAR is missing Location');
        }
        location.value = `/next.php?token=${encodeURIComponent(CAPTURED.token)}`;

        const draft = convertHarToReplayDraft(har);

        expect(
            draft.fixture.phases[0]?.expectations[0]?.response.headers[
                'location'
            ]?.[0]
        ).toMatchObject({
            kind: 'origin-url',
            origin: 'origin-1',
            path: '/next.php',
        });
    });

    it('preserves JSONP structure while redacting its payload', () => {
        const har = representativeHar() as {
            log: {
                entries: Array<{
                    response: {
                        content: { mimeType: string; text: string };
                    };
                }>;
            };
        };
        const content = requiredEntry(har.log.entries, 0).response.content;
        content.mimeType = 'application/javascript';
        content.text = `portalCallback(${JSON.stringify({
            js: { token: CAPTURED.token },
        })});`;

        const draft = convertHarToReplayDraft(har);

        expect(
            draft.fixture.phases[0]?.expectations[0]?.response.body
        ).toMatchObject({
            kind: 'jsonp',
            callback: 'portalCallback',
        });
        expect(draft.formatted).not.toContain(CAPTURED.token);
    });

    it('accepts canonical base64 bodies above the ordinary literal ceiling', () => {
        const har = representativeHar() as {
            log: {
                entries: Array<{
                    response: {
                        content: { encoding?: string; text: string };
                    };
                }>;
            };
        };
        const content = requiredEntry(har.log.entries, 1).response.content;
        const bytes = Buffer.alloc(70 * 1024, 0x5a);
        content.encoding = 'base64';
        content.text = bytes.toString('base64');

        const draft = convertHarToReplayDraft(har);

        expect(draft.fixture.phases[1]?.expectations[0]?.response.body).toEqual(
            {
                kind: 'generated',
                byteLength: bytes.byteLength,
                byte: 0,
            }
        );
    });

    it('rejects external URLs hidden in response JSON', () => {
        const har = representativeHar() as {
            log: {
                entries: Array<{
                    response: {
                        content: { text: string };
                    };
                }>;
            };
        };
        requiredEntry(har.log.entries, 0).response.content.text =
            JSON.stringify({
                js: {
                    stream_url: 'https://unseen.external.invalid/private',
                },
            });

        expectDraftCode(
            () => convertHarToReplayDraft(har),
            HAR_TO_DRAFT_ERROR_CODES.UnknownExternalOrigin
        );
    });

    it('rejects malformed HAR structure and unsupported methods', () => {
        expectDraftCode(
            () => convertHarToReplayDraft({ log: { entries: [] } }),
            HAR_TO_DRAFT_ERROR_CODES.InvalidHarStructure
        );

        const har = representativeHar() as {
            log: { entries: Array<{ request: { method: string } }> };
        };
        requiredEntry(har.log.entries, 0).request.method = 'CONNECT';
        expectDraftCode(
            () => convertHarToReplayDraft(har),
            HAR_TO_DRAFT_ERROR_CODES.UnsupportedMethod
        );
    });

    it('rejects captures above the replay phase ceiling', () => {
        const entry = (representativeHar() as { log: { entries: unknown[] } })
            .log.entries[0];
        const entries = Array.from({ length: 129 }, () => entry);

        expectDraftCode(
            () => convertHarToReplayDraft({ log: { entries } }),
            HAR_TO_DRAFT_ERROR_CODES.TooManyEntries
        );
    });

    it('propagates strict base64 failures without exposing content', () => {
        const har = representativeHar() as {
            log: {
                entries: Array<{
                    response: {
                        content: { encoding?: string; text: string };
                    };
                }>;
            };
        };
        const content = requiredEntry(har.log.entries, 1).response.content;
        content.encoding = 'base64';
        content.text = 'private secret, not base64';

        expect(() => convertHarToReplayDraft(har)).toThrow(
            new HarReaderError(HAR_READER_ERROR_CODES.InvalidBase64)
        );
    });

    it('maps final schema or secret-scan failure to one sanitized code', () => {
        const har = representativeHar() as {
            log: {
                entries: Array<{
                    response: {
                        content: { text: string };
                    };
                }>;
            };
        };
        requiredEntry(har.log.entries, 0).response.content.text =
            JSON.stringify({
                js: {
                    harmless_label: '${x}',
                },
            });

        expectDraftCode(
            () => convertHarToReplayDraft(har),
            HAR_TO_DRAFT_ERROR_CODES.DraftValidationFailed
        );
    });
});

function requiredEntry<T>(entries: readonly T[], index: number): T {
    const entry = entries[index];
    if (entry === undefined) {
        throw new Error('test HAR entry is missing');
    }
    return entry;
}
