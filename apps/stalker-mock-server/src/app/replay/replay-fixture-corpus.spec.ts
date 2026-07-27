/* eslint-disable max-lines -- The committed corpus matrix and its typed deterministic driver form one auditable contract. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
    classifyStalkerDoAuth,
    classifyStalkerProfile,
    classifyStalkerResponseFailure,
    parseStalkerResponseEnvelope,
} from '@iptvnator/portal/stalker/protocol';
import { createReplayRun, type ReplayRun } from './replay-run.js';
import { parseReplayFixtureText } from './replay-schema.js';
import type {
    ReplayExpectation,
    ReplayFixtureV1,
    ReplayGenerateNode,
    ReplayLiteralPart,
    ReplayObservedCookie,
    ReplayObservedRequest,
    ReplayPartsNode,
    ReplayRefNode,
    ReplayRenderedResponse,
    ReplayResponseHeaderValue,
    ReplayTemplateString,
    ReplayTemplateValue,
} from './replay.types.js';

const FIXTURE_ROOT = resolve(
    process.cwd(),
    'apps/stalker-mock-server/fixtures/replay'
);

const EXPECTED_SCENARIOS = [
    'authentication-blocked-profile',
    'authentication-noncanonical-do-auth',
    'authentication-noncanonical-do-auth-string',
    'authentication-saved-rejected-fresh',
    'authentication-status2-second-step',
    'authentication-three-attempt-limit',
    'classifier-access-denied-200',
    'classifier-ambiguous-403',
    'classifier-auth-failed-403',
    'classifier-authorization-failed-200',
    'classifier-authorization-failed-near-miss-200',
    'classifier-oversized-response',
    'classifier-profile-status-strings',
    'classifier-rate-limit-429',
    'classifier-service-unavailable-503',
    'classifier-waf-403',
    'classifier-wrong-mime-json',
    'cookies-managed-shadow',
    'cookies-session-isolation',
    'e2e-concurrent-catalog-refresh',
    'e2e-full-session-catalog-playback',
    'redirect-auth-query',
    'redirect-identity-pause',
    'redirect-landing-approval',
    'redirect-malicious-user-info',
    'redirect-repeated-loop',
    'refresh-concurrent-rejections',
    'refresh-exhausted-retry',
    'resolver-custom-prefix-full',
    'resolver-direct-load-jsonp',
    'resolver-direct-portal-statusless',
    'resolver-downgrade-protection',
    'resolver-learned-rediscovery',
    'resolver-root-full-wins',
    'resolver-root-landing',
] as const;

const RESERVED_EARLY_QUERY_FIELDS = [
    'device_id',
    'device_id2',
    'mac',
    'password',
    'signature',
    'signature2',
    'sn',
    'token',
    'username',
] as const;
const RESERVED_EARLY_HEADERS = ['authorization', 'cookie'] as const;
const RESERVED_EARLY_COOKIES = ['mac', 'session'] as const;
const UNIT_OWNED_COOKIE_MATRIX = [
    {
        contract:
            'RFC Domain, Path, Secure, HttpOnly, and duplicate-name selection',
        evidence:
            'applies RFC domain, path, secure, HttpOnly, and duplicate-name rules',
        spec: 'apps/electron-backend/src/app/services/stalker-session/stalker-cookie-jar.spec.ts',
    },
    {
        contract: 'cookie expiry against a deterministic clock',
        evidence: 'honors expiry against an injected clock',
        spec: 'apps/electron-backend/src/app/services/stalker-session/stalker-cookie-jar.spec.ts',
    },
    {
        contract: 'public-suffix Domain rejection',
        evidence: 'rejects public-suffix cookies without retaining them',
        spec: 'apps/electron-backend/src/app/services/stalker-session/stalker-cookie-jar.spec.ts',
    },
    {
        contract: 'redirect-hop cookie collection and rotation',
        evidence:
            'prepares and collects the cookie jar on every same-origin hop without flattening Set-Cookie arrays',
        spec: 'apps/electron-backend/src/app/services/stalker-session/stalker-http-session.spec.ts',
    },
] as const;

function collectFixturePaths(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => compareCodeUnits(left.name, right.name))
        .flatMap((entry) => {
            const entryPath = join(directory, entry.name);
            if (entry.isDirectory()) {
                return collectFixturePaths(entryPath);
            }
            if (entry.isFile() && entry.name.endsWith('.json')) {
                return [entryPath];
            }
            throw new Error(`Unsafe replay fixture entry: ${entry.name}.`);
        });
}

function resolveString(
    value: ReplayTemplateString,
    bindings: ReadonlyMap<string, string>
): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value.kind === 'ref') {
        const resolved = bindings.get(value.symbol);
        if (resolved === undefined) {
            throw new Error(`Fixture driver symbol missing: ${value.symbol}.`);
        }
        return resolved;
    }
    if (value.kind === 'parts') {
        return value.parts
            .map((part) =>
                part.kind === 'literal'
                    ? part.value
                    : resolveString(part, bindings)
            )
            .join('');
    }
    throw new Error(
        `Fixture request cannot generate symbol: ${value.symbol}.`
    );
}

function templateNodeKind(value: object): unknown {
    return (value as { kind?: unknown }).kind;
}

function resolveValue(
    value: ReplayTemplateValue,
    bindings: ReadonlyMap<string, string>
): unknown {
    if (
        value === null ||
        typeof value === 'boolean' ||
        typeof value === 'number' ||
        typeof value === 'string'
    ) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => resolveValue(item, bindings));
    }
    const kind = templateNodeKind(value);
    if (kind === 'ref' || kind === 'parts' || kind === 'generate') {
        return resolveString(value as ReplayTemplateString, bindings);
    }
    return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
            key,
            resolveValue(child, bindings),
        ])
    );
}

function resolveRepeatedFields(
    exact: ReplayExpectation['request']['query']['exact'],
    present: readonly string[],
    bindings: ReadonlyMap<string, string>
): Record<string, string[]> {
    const fields = Object.create(null) as Record<string, string[]>;
    for (const [name, value] of Object.entries(exact)) {
        const values = Array.isArray(value) ? value : [value];
        fields[name] = values.map((item) =>
            resolveString(item, bindings)
        );
    }
    for (const name of present) {
        fields[name] ??= ['synthetic-present'];
    }
    return fields;
}

function observedRequest(
    expectation: ReplayExpectation,
    bindings: ReadonlyMap<string, string>
): ReplayObservedRequest {
    const cookies = Object.create(null) as Record<
        string,
        ReplayObservedCookie
    >;
    for (const [name, value] of Object.entries(
        expectation.request.cookies.exact
    )) {
        const attributes = expectation.request.cookies.attributes[name];
        cookies[name] = {
            value: resolveString(value, bindings),
            ...(attributes === undefined
                ? {}
                : {
                      attributes: Object.fromEntries(
                          Object.entries(attributes).map(
                              ([attribute, attributeValue]) => [
                                  attribute,
                                  typeof attributeValue === 'object' ||
                                  typeof attributeValue === 'string'
                                      ? resolveString(
                                            attributeValue as ReplayTemplateString,
                                            bindings
                                        )
                                      : attributeValue,
                              ]
                          )
                      ),
                  }),
        };
    }
    for (const name of expectation.request.cookies.present) {
        cookies[name] ??= { value: 'synthetic-present' };
    }

    const matcher = expectation.request.body;
    const body: ReplayObservedRequest['body'] =
        matcher.kind === 'absent'
            ? { kind: 'absent' }
            : matcher.kind === 'text'
              ? {
                    kind: 'text',
                    value: resolveString(matcher.exact, bindings),
                }
              : matcher.kind === 'form'
                ? {
                      kind: 'form',
                      value: Object.fromEntries([
                          ...Object.entries(matcher.exact).map(
                              ([name, value]) => [
                                  name,
                                  resolveString(value, bindings),
                              ]
                          ),
                          ...matcher.present
                              .filter(
                                  (name) =>
                                      !Object.prototype.hasOwnProperty.call(
                                          matcher.exact,
                                          name
                                      )
                              )
                              .map((name) => [
                                  name,
                                  'synthetic-present',
                              ]),
                      ]),
                  }
                : {
                      kind: 'json',
                      value: Object.fromEntries([
                          ...Object.entries(matcher.exact).map(
                              ([name, value]) => [
                                  name,
                                  resolveValue(value, bindings),
                              ]
                          ),
                          ...matcher.present
                              .filter(
                                  (name) =>
                                      !Object.prototype.hasOwnProperty.call(
                                          matcher.exact,
                                          name
                                      )
                              )
                              .map((name) => [
                                  name,
                                  'synthetic-present',
                              ]),
                      ]) as ReplayObservedRequest['body'] extends {
                          kind: 'json';
                          value: infer Value;
                      }
                          ? Value
                          : never,
                  };

    return {
        origin: expectation.origin,
        method: expectation.method,
        path: expectation.path,
        query: resolveRepeatedFields(
            expectation.request.query.exact,
            expectation.request.query.present,
            bindings
        ),
        headers: resolveRepeatedFields(
            expectation.request.headers.exact,
            expectation.request.headers.present,
            bindings
        ),
        cookies,
        body,
    };
}

function captureTemplateValue(
    template: ReplayTemplateValue,
    rendered: unknown,
    bindings: Map<string, string>
): void {
    if (
        template === null ||
        typeof template === 'boolean' ||
        typeof template === 'number' ||
        typeof template === 'string'
    ) {
        return;
    }
    if (Array.isArray(template)) {
        if (!Array.isArray(rendered)) {
            return;
        }
        template.forEach((item, index) =>
            captureTemplateValue(item, rendered[index], bindings)
        );
        return;
    }
    const kind = templateNodeKind(template);
    if (kind === 'generate') {
        const generated = template as ReplayGenerateNode;
        if (typeof rendered !== 'string') {
            throw new Error(
                `Generated fixture symbol was not rendered as a string: ${generated.symbol}.`
            );
        }
        bindings.set(generated.symbol, rendered);
        return;
    }
    if (kind === 'ref') {
        if (typeof rendered === 'string') {
            captureRefBinding(
                template as ReplayRefNode,
                rendered,
                bindings
            );
        }
        return;
    }
    if (kind === 'parts') {
        if (typeof rendered === 'string') {
            capturePartsBindings(
                template as ReplayPartsNode,
                rendered,
                bindings
            );
        }
        return;
    }
    if (rendered === null || typeof rendered !== 'object') {
        return;
    }
    for (const [key, child] of Object.entries(template)) {
        captureTemplateValue(
            child,
            (rendered as Record<string, unknown>)[key],
            bindings
        );
    }
}

function captureRefBinding(
    template: ReplayRefNode,
    rendered: string,
    bindings: Map<string, string>
): void {
    const existing = bindings.get(template.symbol);
    if (existing !== undefined && existing !== rendered) {
        throw new Error(
            `Fixture driver symbol changed: ${template.symbol}.`
        );
    }
    bindings.set(template.symbol, rendered);
}

function capturePartsBindings(
    template: ReplayPartsNode,
    rendered: string,
    bindings: Map<string, string>
): void {
    let cursor = 0;
    template.parts.forEach((part, index) => {
        if (part.kind === 'literal') {
            if (!rendered.startsWith(part.value, cursor)) {
                throw new Error(
                    'Fixture driver could not match rendered parts.'
                );
            }
            cursor += part.value.length;
            return;
        }

        const existing = bindings.get(part.symbol);
        if (existing !== undefined) {
            if (!rendered.startsWith(existing, cursor)) {
                throw new Error(
                    `Fixture driver symbol changed: ${part.symbol}.`
                );
            }
            cursor += existing.length;
            return;
        }

        const nextLiteral = template.parts
            .slice(index + 1)
            .find(
                (
                    candidate
                ): candidate is ReplayLiteralPart =>
                    candidate.kind === 'literal' &&
                    candidate.value.length > 0
            );
        const boundary =
            nextLiteral === undefined
                ? rendered.length
                : rendered.indexOf(nextLiteral.value, cursor);
        if (boundary < cursor) {
            throw new Error(
                `Fixture driver could not delimit symbol: ${part.symbol}.`
            );
        }
        bindings.set(part.symbol, rendered.slice(cursor, boundary));
        cursor = boundary;
    });
    if (cursor !== rendered.length) {
        throw new Error('Fixture driver left unmatched rendered parts.');
    }
}

function captureHeaderValue(
    template: ReplayResponseHeaderValue,
    rendered: string,
    bindings: Map<string, string>
): void {
    if (typeof template === 'string') {
        return;
    }
    if (template.kind === 'generate') {
        bindings.set(template.symbol, rendered);
        return;
    }
    if (template.kind === 'ref') {
        captureRefBinding(template, rendered, bindings);
        return;
    }
    if (template.kind === 'parts') {
        capturePartsBindings(template, rendered, bindings);
        return;
    }
    if (template.kind !== 'origin-url') {
        return;
    }
    const url = new URL(rendered);
    if (
        template.userInfo?.username !== undefined &&
        typeof template.userInfo.username !== 'string' &&
        template.userInfo.username.kind === 'generate'
    ) {
        bindings.set(
            template.userInfo.username.symbol,
            decodeURIComponent(url.username)
        );
    }
    if (
        template.userInfo?.password !== undefined &&
        typeof template.userInfo.password !== 'string' &&
        template.userInfo.password.kind === 'generate'
    ) {
        bindings.set(
            template.userInfo.password.symbol,
            decodeURIComponent(url.password)
        );
    }
    for (const [name, queryValue] of Object.entries(
        template.query ?? {}
    )) {
        const templates = Array.isArray(queryValue)
            ? queryValue
            : [queryValue];
        const values = url.searchParams.getAll(name);
        templates.forEach((item, index) => {
            if (
                typeof item !== 'string' &&
                item.kind === 'generate' &&
                values[index] !== undefined
            ) {
                bindings.set(item.symbol, values[index]);
            }
        });
    }
}

function captureResponseBindings(
    expectation: ReplayExpectation,
    response: ReplayRenderedResponse,
    bindings: Map<string, string>
): void {
    for (const [name, templates] of Object.entries(
        expectation.response.headers
    )) {
        const renderedValues = response.headers[name] ?? [];
        templates.forEach((template, index) => {
            const rendered = renderedValues[index];
            if (rendered !== undefined) {
                captureHeaderValue(template, rendered, bindings);
            }
        });
    }
    const body = expectation.response.body;
    if (body.kind === 'json') {
        captureTemplateValue(
            body.value,
            JSON.parse(response.body.toString('utf8')),
            bindings
        );
    } else if (body.kind === 'jsonp') {
        const text = response.body.toString('utf8');
        const prefix = `${body.callback}(`;
        captureTemplateValue(
            body.value,
            JSON.parse(text.slice(prefix.length, -2)),
            bindings
        );
    } else if (
        body.kind === 'text' &&
        typeof body.value !== 'string' &&
        body.value.kind === 'generate'
    ) {
        bindings.set(body.value.symbol, response.body.toString('utf8'));
    }
}

async function driveFixture(
    run: ReplayRun,
    fixture: ReplayFixtureV1
): Promise<void> {
    const bindings = new Map(Object.entries(run.getGeneratedInputs()));
    for (const phase of fixture.phases) {
        if (phase.barrier !== undefined) {
            const requests = phase.expectations.flatMap(
                (expectation) =>
                    Array.from(
                        { length: expectation.cardinality.min },
                        () => ({
                            expectation,
                            request: observedRequest(
                                expectation,
                                bindings
                            ),
                        })
                    )
            );
            const responses = await Promise.all(
                requests.map(({ request }) => run.request(request))
            );
            responses.forEach((response, index) => {
                const request = requests[index];
                if (request === undefined) {
                    throw new Error(
                        'Fixture driver lost a barrier request.'
                    );
                }
                captureResponseBindings(
                    request.expectation,
                    response,
                    bindings
                );
            });
            continue;
        }
        for (const expectation of phase.expectations) {
            for (
                let matchCount = 0;
                matchCount < expectation.cardinality.min;
                matchCount += 1
            ) {
                const response = await run.request(
                    observedRequest(expectation, bindings)
                );
                captureResponseBindings(
                    expectation,
                    response,
                    bindings
                );
            }
        }
    }
}

function assertAnonymousRequestHasNoReservedSecrets(
    fixture: ReplayFixtureV1
): void {
    const anonymous = fixture.phases[0]?.expectations[0];
    if (anonymous === undefined) {
        throw new Error(
            `Authentication fixture lacks an anonymous request: ${fixture.scenarioId}.`
        );
    }
    expect(anonymous.operation).toBe('anonymous-probe');
    expect(anonymous.request.query.absent).toEqual(
        expect.arrayContaining([...RESERVED_EARLY_QUERY_FIELDS])
    );
    expect(anonymous.request.headers.absent).toEqual(
        expect.arrayContaining([...RESERVED_EARLY_HEADERS])
    );
    expect(anonymous.request.cookies.absent).toEqual(
        expect.arrayContaining([...RESERVED_EARLY_COOKIES])
    );
}

function loadFixture(scenarioId: string): ReplayFixtureV1 {
    for (const fixturePath of collectFixturePaths(FIXTURE_ROOT)) {
        const fixture = parseReplayFixtureText(
            readFileSync(fixturePath, 'utf8')
        );
        if (fixture.scenarioId === scenarioId) {
            return fixture;
        }
    }
    throw new Error(`Replay matrix fixture missing: ${scenarioId}.`);
}

function findExpectation(
    fixture: ReplayFixtureV1,
    operation: string
): ReplayExpectation {
    const expectation = fixture.phases
        .flatMap((phase) => phase.expectations)
        .find((candidate) => candidate.operation === operation);
    if (expectation === undefined) {
        throw new Error(
            `Replay matrix operation missing: ${fixture.scenarioId}/${operation}.`
        );
    }
    return expectation;
}

function jsonResponseValue(expectation: ReplayExpectation): unknown {
    if (expectation.response.body.kind !== 'json') {
        throw new Error(
            `Replay matrix response is not JSON: ${expectation.operation}.`
        );
    }
    return expectation.response.body.value;
}

function responseFailureInput(expectation: ReplayExpectation): {
    readonly httpStatus: number;
    readonly rawBody?: string;
    readonly value?: unknown;
} {
    const body = expectation.response.body;
    return {
        httpStatus: expectation.response.status,
        ...(body.kind === 'json' ? { value: body.value } : {}),
        ...(body.kind === 'text' && typeof body.value === 'string'
            ? { rawBody: body.value }
            : {}),
    };
}

describe('committed replay fixture corpus', () => {
    it('contains the complete Stage-1 scenario matrix', () => {
        const scenarioIds = collectFixturePaths(FIXTURE_ROOT)
            .map((fixturePath) =>
                parseReplayFixtureText(
                    readFileSync(fixturePath, 'utf8')
                )
            )
            .map((fixture) => fixture.scenarioId)
            .sort(compareCodeUnits);

        expect(scenarioIds).toEqual([...EXPECTED_SCENARIOS]);
    });

    it('drives every fixture through exact terminal/cardinality evidence', async () => {
        for (const fixturePath of collectFixturePaths(FIXTURE_ROOT)) {
            const fixture = parseReplayFixtureText(
                readFileSync(fixturePath, 'utf8')
            );
            if (
                fixturePath.startsWith(
                    join(FIXTURE_ROOT, 'authentication')
                )
            ) {
                assertAnonymousRequestHasNoReservedSecrets(fixture);
            }

            const run = createReplayRun(fixture, {
                runId: `fixture-${fixture.scenarioId}`,
                originUrls: Object.fromEntries(
                    Object.keys(fixture.origins).map((origin) => [
                        origin,
                        `http://${origin}.test/__fixture/${fixture.scenarioId}`,
                    ])
                ),
            });
            try {
                await driveFixture(run, fixture);
                expect({
                    scenarioId: fixture.scenarioId,
                    result: run.finalize(),
                }).toMatchObject({
                    scenarioId: fixture.scenarioId,
                    result: { ok: true },
                });
            } finally {
                run.dispose();
            }
        }
    });

    it('binds numeric and string profile statuses to the production classifier matrix', () => {
        const cases = [
            {
                expected: { kind: 'ready', status: 0 },
                operation: 'full-profile',
                wireStatus: 0,
                scenarioId: 'resolver-root-full-wins',
            },
            {
                expected: { kind: 'blocked', status: 1 },
                operation: 'blocked-profile',
                wireStatus: 1,
                scenarioId: 'authentication-blocked-profile',
            },
            {
                expected: { kind: 'credentials-required', status: 2 },
                operation: 'profile-first',
                wireStatus: 2,
                scenarioId: 'authentication-status2-second-step',
            },
            {
                expected: { kind: 'ready', status: 0 },
                operation: 'profile-string-ready',
                wireStatus: '0',
                scenarioId: 'classifier-profile-status-strings',
            },
            {
                expected: { kind: 'blocked', status: 1 },
                operation: 'profile-string-blocked',
                wireStatus: '1',
                scenarioId: 'classifier-profile-status-strings',
            },
            {
                expected: { kind: 'credentials-required', status: 2 },
                operation: 'profile-string-credentials',
                wireStatus: '2',
                scenarioId: 'classifier-profile-status-strings',
            },
        ] as const;

        for (const current of cases) {
            const response = jsonResponseValue(
                findExpectation(
                    loadFixture(current.scenarioId),
                    current.operation
                )
            ) as { readonly js?: Readonly<Record<string, unknown>> };
            expect(response.js?.['status']).toBe(current.wireStatus);
            expect(classifyStalkerProfile(response)).toMatchObject(
                current.expected
            );
        }

        const stringFixture = loadFixture(
            'classifier-profile-status-strings'
        );
        const ready = jsonResponseValue(
            findExpectation(stringFixture, 'profile-string-ready')
        ) as { readonly js: Readonly<Record<string, unknown>> };
        const blocked = jsonResponseValue(
            findExpectation(stringFixture, 'profile-string-blocked')
        ) as { readonly js: Readonly<Record<string, unknown>> };
        expect([
            ready.js['store_auth_data_on_stb'],
            blocked.js['store_auth_data_on_stb'],
        ]).toEqual([true, false]);
    });

    it('binds canonical do_auth success, rejection, and near misses to production rules', () => {
        const cases = [
            {
                expected: { kind: 'success' },
                operation: 'do-auth',
                scenarioId: 'authentication-status2-second-step',
            },
            {
                expected: { kind: 'credentials-rejected' },
                operation: 'saved-do-auth',
                scenarioId: 'authentication-saved-rejected-fresh',
            },
            {
                expected: {
                    kind: 'failure',
                    reason: 'incompatible-response',
                },
                operation: 'do-auth-noncanonical',
                scenarioId: 'authentication-noncanonical-do-auth',
            },
            {
                expected: {
                    kind: 'failure',
                    reason: 'incompatible-response',
                },
                operation: 'do-auth-noncanonical-string',
                scenarioId: 'authentication-noncanonical-do-auth-string',
            },
        ] as const;

        for (const current of cases) {
            expect(
                classifyStalkerDoAuth(
                    jsonResponseValue(
                        findExpectation(
                            loadFixture(current.scenarioId),
                            current.operation
                        )
                    )
                )
            ).toEqual(current.expected);
        }
    });

    it('binds token, denial, protection, and ambiguous bodies to the production failure taxonomy', () => {
        const cases = [
            {
                expected: { kind: 'token-rejected' },
                operation: 'authorization-failed',
                scenarioId: 'classifier-authorization-failed-200',
            },
            {
                expected: { kind: 'token-rejected' },
                operation: 'authorization-failed-forbidden',
                scenarioId: 'classifier-auth-failed-403',
            },
            {
                expected: {
                    kind: 'failure',
                    reason: 'incompatible-response',
                },
                operation: 'authorization-failed-near-miss',
                scenarioId:
                    'classifier-authorization-failed-near-miss-200',
            },
            {
                expected: {
                    kind: 'failure',
                    reason: 'account-access-denied',
                },
                operation: 'body-denial',
                scenarioId: 'classifier-access-denied-200',
            },
            {
                expected: {
                    kind: 'failure',
                    reason: 'portal-protection-blocked',
                },
                operation: 'waf-response',
                scenarioId: 'classifier-waf-403',
            },
            {
                expected: {
                    kind: 'failure',
                    reason: 'incompatible-response',
                },
                operation: 'ambiguous-forbidden',
                scenarioId: 'classifier-ambiguous-403',
            },
            {
                expected: {
                    kind: 'failure',
                    reason: 'rate-limited',
                },
                operation: 'rate-limit',
                scenarioId: 'classifier-rate-limit-429',
            },
            {
                expected: {
                    kind: 'failure',
                    reason: 'portal-unavailable',
                },
                operation: 'service-unavailable',
                scenarioId: 'classifier-service-unavailable-503',
            },
        ] as const;

        for (const current of cases) {
            const expectation = findExpectation(
                loadFixture(current.scenarioId),
                current.operation
            );
            expect(
                classifyStalkerResponseFailure(
                    responseFailureInput(expectation)
                )
            ).toEqual(current.expected);
        }
    });

    it('fails closed when valid replay JSON carries an HTML media type', () => {
        const expectation = findExpectation(
            loadFixture('classifier-wrong-mime-json'),
            'wrong-mime-json'
        );
        const body = expectation.response.body;
        const contentType =
            expectation.response.headers['content-type']?.[0];
        if (
            body.kind !== 'text' ||
            typeof body.value !== 'string' ||
            typeof contentType !== 'string'
        ) {
            throw new Error('Wrong-MIME matrix fixture is malformed.');
        }

        expect(
            parseStalkerResponseEnvelope({
                body: body.value,
                contentType,
                maxBodyBytes: 1024,
            })
        ).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
        });
    });

    it('records portal protection after stateless evidence as a no-downgrade terminal', () => {
        const fixture = loadFixture('resolver-downgrade-protection');
        const operations = fixture.phases.flatMap((phase) =>
            phase.expectations.map((expectation) => expectation.operation)
        );
        const unsupported = findExpectation(
            fixture,
            'unsupported-handshake'
        );
        const stateless = jsonResponseValue(
            findExpectation(fixture, 'stateless-capability')
        ) as { readonly js?: unknown };
        const authenticatedHandshake = jsonResponseValue(
            findExpectation(fixture, 'authenticated-handshake')
        ) as {
            readonly js?: Readonly<Record<string, unknown>>;
        };
        const protectedProfile = findExpectation(
            fixture,
            'protected-first-profile'
        );

        expect(operations).toEqual([
            'root-probe',
            'unsupported-handshake',
            'stateless-capability',
            'authenticated-handshake',
            'protected-first-profile',
        ]);
        expect(
            classifyStalkerResponseFailure(
                responseFailureInput(unsupported)
            )
        ).toEqual({ kind: 'none' });
        expect(Array.isArray(stateless.js)).toBe(true);
        expect(authenticatedHandshake.js?.['token']).toMatchObject({
            kind: 'generate',
            valueKind: 'token',
        });
        expect(
            classifyStalkerResponseFailure(
                responseFailureInput(protectedProfile)
            )
        ).toEqual({
            kind: 'failure',
            reason: 'portal-protection-blocked',
        });
        expect(fixture.phases.at(-1)?.nextState).toBe(
            fixture.terminalState
        );
    });

    it('keeps mutable RFC cookie semantics in production unit coverage while replay owns wire rotation', () => {
        const rotationFixture = loadFixture(
            'e2e-full-session-catalog-playback'
        );
        const rotatingOperations = ['handshake', 'do-auth', 'catalog-page'];
        for (const operation of rotatingOperations) {
            expect(
                findExpectation(rotationFixture, operation).response.headers[
                    'set-cookie'
                ]
            ).toHaveLength(1);
        }

        for (const current of UNIT_OWNED_COOKIE_MATRIX) {
            const specSource = readFileSync(
                resolve(process.cwd(), current.spec),
                'utf8'
            );
            expect({
                contract: current.contract,
                covered: specSource.includes(current.evidence),
            }).toEqual({
                contract: current.contract,
                covered: true,
            });
        }
    });

    it('terminates both noncanonical do_auth near misses before a second profile', () => {
        const cases = [
            {
                expectedJs: 1,
                fileName: 'noncanonical-do-auth.json',
                scenarioId: 'authentication-noncanonical-do-auth',
            },
            {
                expectedJs: 'true',
                fileName: 'noncanonical-do-auth-string.json',
                scenarioId: 'authentication-noncanonical-do-auth-string',
            },
        ] as const;

        for (const current of cases) {
            const fixture = parseReplayFixtureText(
                readFileSync(
                    join(FIXTURE_ROOT, 'authentication', current.fileName),
                    'utf8'
                )
            );
            const expectations = fixture.phases.flatMap(
                (phase) => phase.expectations
            );
            const profileSteps = expectations
                .filter(
                    (expectation) =>
                        expectation.request.query.exact['action'] ===
                        'get_profile'
                )
                .map(
                    (expectation) =>
                        expectation.request.query.exact['auth_second_step']
                );
            const doAuth = expectations.find(
                (expectation) =>
                    expectation.request.query.exact['action'] === 'do_auth'
            );
            if (doAuth?.response.body.kind !== 'json') {
                throw new Error(
                    `Noncanonical fixture lacks do_auth JSON: ${fixture.scenarioId}.`
                );
            }
            const doAuthValue = doAuth.response.body.value as {
                readonly js?: unknown;
            };
            const terminalPhase = fixture.phases.find((phase) =>
                phase.expectations.includes(doAuth)
            );

            expect(fixture).toMatchObject({
                failOnUnexpectedRequest: true,
                scenarioId: current.scenarioId,
            });
            expect(doAuthValue.js).toBe(current.expectedJs);
            expect(
                classifyStalkerDoAuth({ js: doAuthValue.js })
            ).toEqual({
                kind: 'failure',
                reason: 'incompatible-response',
            });
            expect(profileSteps).toEqual(['0']);
            expect(terminalPhase?.nextState).toBe(fixture.terminalState);
        }
    });
});

function compareCodeUnits(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}
