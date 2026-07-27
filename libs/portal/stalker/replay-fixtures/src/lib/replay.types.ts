import {
    REPLAY_HTTP_METHODS,
    REPLAY_SYMBOL_VALUE_KINDS,
} from './replay.constants.js';

export type ReplayHttpMethod = (typeof REPLAY_HTTP_METHODS)[number];
export type ReplaySymbolValueKind = (typeof REPLAY_SYMBOL_VALUE_KINDS)[number];

export type ReplayJsonPrimitive = string | number | boolean | null;

export type ReplayJsonValue =
    | ReplayJsonPrimitive
    | ReplayJsonValue[]
    | { [key: string]: ReplayJsonValue };

export interface ReplayGenerateNode {
    kind: 'generate';
    symbol: string;
    valueKind: ReplaySymbolValueKind;
}

export interface ReplayRefNode {
    kind: 'ref';
    symbol: string;
}

export interface ReplayLiteralPart {
    kind: 'literal';
    value: string;
}

export interface ReplayPartsNode {
    kind: 'parts';
    parts: Array<ReplayLiteralPart | ReplayRefNode>;
}

export interface ReplayOriginUrlUserInfo {
    username: ReplayTemplateString;
    password?: ReplayTemplateString;
}

export interface ReplayOriginUrlNode {
    kind: 'origin-url';
    origin: string;
    path: string;
    userInfo?: ReplayOriginUrlUserInfo;
    query?: Record<string, ReplayTemplateString | ReplayTemplateString[]>;
}

export type ReplayTemplateString =
    | string
    | ReplayGenerateNode
    | ReplayRefNode
    | ReplayPartsNode;

export type ReplayResponseHeaderValue =
    | ReplayTemplateString
    | ReplayOriginUrlNode;

export type ReplayTemplateValue =
    | ReplayJsonPrimitive
    | ReplayGenerateNode
    | ReplayRefNode
    | ReplayPartsNode
    | ReplayTemplateValue[]
    | { [key: string]: ReplayTemplateValue };

export type ReplayMatchValue =
    | ReplayJsonPrimitive
    | ReplayRefNode
    | ReplayPartsNode;

export interface ReplayFieldMatchers<T = ReplayMatchValue> {
    exact: Record<string, T>;
    present: string[];
    absent: string[];
}

export type ReplayRequestBodyMatcher =
    | { kind: 'absent' }
    | ({ kind: 'json' } & ReplayFieldMatchers<ReplayTemplateValue>)
    | ({ kind: 'form' } & ReplayFieldMatchers<ReplayTemplateString>)
    | { kind: 'text'; exact: ReplayTemplateString };

export interface ReplayCookieAttributeMatchers {
    domain?: ReplayTemplateString;
    path?: ReplayTemplateString;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
    maxAge?: number;
    expires?: ReplayTemplateString;
}

export interface ReplayCookieMatchers extends ReplayFieldMatchers<ReplayTemplateString> {
    attributes: Record<string, ReplayCookieAttributeMatchers>;
}

export interface ReplayRequestMatcher {
    query: ReplayFieldMatchers<
        ReplayTemplateString | ReplayTemplateString[]
    >;
    headers: ReplayFieldMatchers<ReplayTemplateString | ReplayTemplateString[]>;
    cookies: ReplayCookieMatchers;
    body: ReplayRequestBodyMatcher;
}

export type ReplayResponseBody =
    | { kind: 'empty' }
    | { kind: 'json'; value: ReplayTemplateValue }
    | {
          kind: 'jsonp';
          callback: string;
          value: ReplayTemplateValue;
      }
    | { kind: 'text'; value: ReplayTemplateString }
    | { kind: 'generated'; byteLength: number; byte: number };

export interface ReplayResponseDefinition {
    status: number;
    headers: Record<string, ReplayResponseHeaderValue[]>;
    body: ReplayResponseBody;
}

export interface ReplayCardinality {
    min: number;
    max: number;
}

export interface ReplayExpectation {
    id: string;
    operation: string;
    origin: string;
    method: ReplayHttpMethod;
    path: string;
    request: ReplayRequestMatcher;
    response: ReplayResponseDefinition;
    cardinality: ReplayCardinality;
}

export interface ReplayBarrier {
    name: string;
    releaseWhenMatched: number;
}

export interface ReplayPhase {
    name: string;
    state: string;
    nextState: string;
    mode: 'ordered' | 'unordered';
    barrier?: ReplayBarrier;
    expectations: ReplayExpectation[];
}

export interface ReplayOriginDefinition {
    description?: string;
}

export interface ReplayEndpointDefinition {
    origin: string;
    path: string;
}

export interface ReplayFixtureV1 {
    schemaVersion: 1;
    scenarioId: string;
    description?: string;
    origins: Record<string, ReplayOriginDefinition>;
    entry: ReplayEndpointDefinition;
    expectedEndpoint: ReplayEndpointDefinition;
    initialState: string;
    terminalState: string;
    failOnUnexpectedRequest: boolean;
    symbols: ReplayGenerateNode[];
    phases: ReplayPhase[];
}

export interface ReplayObservedCookie {
    value: string;
    attributes?: Partial<{
        domain: string;
        path: string;
        secure: boolean;
        httpOnly: boolean;
        sameSite: 'strict' | 'lax' | 'none';
        maxAge: number;
        expires: string;
    }>;
}

export type ReplayObservedRequestBody =
    | { kind: 'absent' }
    | { kind: 'json'; value: ReplayJsonValue }
    | { kind: 'form'; value: Record<string, string> }
    | { kind: 'text'; value: string };

export interface ReplayObservedRequest {
    origin: string;
    method: ReplayHttpMethod;
    path: string;
    query: Record<string, string[]>;
    headers: Record<string, string[]>;
    cookies: Record<string, ReplayObservedCookie>;
    body: ReplayObservedRequestBody;
}

export interface ReplayRenderedResponse {
    status: number;
    headers: Record<string, string[]>;
    body: Buffer;
}
