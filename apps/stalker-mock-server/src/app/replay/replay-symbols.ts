import { createHash, randomBytes } from 'node:crypto';
import {
    ReplayGenerateNode,
    ReplayTemplateString,
    ReplayTemplateValue,
} from './replay.types.js';

export class ReplaySymbolError extends Error {
    constructor(readonly code: 'duplicate-symbol' | 'unknown-symbol') {
        super(`Replay symbol error: ${code}.`);
        this.name = 'ReplaySymbolError';
    }
}

function digest(runId: string, symbol: string, valueKind: string): string {
    return createHash('sha256')
        .update('iptvnator-stalker-replay-v1\0')
        .update(runId)
        .update('\0')
        .update(symbol)
        .update('\0')
        .update(valueKind)
        .digest('hex');
}

function generatedValue(node: ReplayGenerateNode, runId: string): string {
    const hash = digest(runId, node.symbol, node.valueKind);
    switch (node.valueKind) {
        case 'mac':
            return `02:${hash.slice(0, 2)}:${hash.slice(2, 4)}:${hash.slice(4, 6)}:${hash.slice(6, 8)}:${hash.slice(8, 10)}`.toUpperCase();
        case 'credential':
            return `test-credential-${hash.slice(0, 24)}`;
        case 'token':
            return `test-token-${hash.slice(0, 40)}`;
        case 'random':
            return `test-random-${hash.slice(0, 24)}`;
        case 'cookie':
            return `test-cookie-${hash.slice(0, 32)}`;
        case 'correlation':
            return `test-correlation-${hash.slice(0, 32)}`;
    }
}

export function createReplayRunId(): string {
    return `run-${randomBytes(16).toString('hex')}`;
}

export class ReplaySymbolTable {
    private readonly values = new Map<string, string>();
    private readonly valueKinds = new Map<
        string,
        ReplayGenerateNode['valueKind']
    >();
    private readonly clientInputSymbols = new Set<string>();

    constructor(
        private readonly runId: string,
        initialSymbols: ReplayGenerateNode[]
    ) {
        for (const node of initialSymbols) {
            this.generate(node);
            if (node.valueKind === 'mac' || node.valueKind === 'credential') {
                this.clientInputSymbols.add(node.symbol);
            }
        }
    }

    generate(node: ReplayGenerateNode): string {
        const existing = this.values.get(node.symbol);
        if (existing !== undefined) {
            if (this.valueKinds.get(node.symbol) !== node.valueKind) {
                throw new ReplaySymbolError('duplicate-symbol');
            }
            return existing;
        }
        const value = generatedValue(node, this.runId);
        this.values.set(node.symbol, value);
        this.valueKinds.set(node.symbol, node.valueKind);
        return value;
    }

    resolveString(value: ReplayTemplateString): string {
        if (typeof value === 'string') {
            return value;
        }
        switch (value.kind) {
            case 'generate':
                return this.generate(value);
            case 'ref': {
                const resolved = this.values.get(value.symbol);
                if (resolved === undefined) {
                    throw new ReplaySymbolError('unknown-symbol');
                }
                return resolved;
            }
            case 'parts':
                return value.parts
                    .map((part) =>
                        part.kind === 'literal'
                            ? part.value
                            : this.resolveString(part)
                    )
                    .join('');
        }
    }

    resolveValue(value: ReplayTemplateValue): unknown {
        if (
            value === null ||
            typeof value === 'boolean' ||
            typeof value === 'number' ||
            typeof value === 'string'
        ) {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.resolveValue(item));
        }
        if (
            'kind' in value &&
            (value.kind === 'generate' ||
                value.kind === 'ref' ||
                value.kind === 'parts')
        ) {
            return this.resolveString(value as ReplayTemplateString);
        }
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                this.resolveValue(item),
            ])
        );
    }

    clientInputSnapshot(): Readonly<Record<string, string>> {
        return Object.freeze(
            Object.fromEntries(
                [...this.values.entries()]
                    .filter(([symbol]) => this.clientInputSymbols.has(symbol))
                    .sort(([left], [right]) => left.localeCompare(right))
            )
        );
    }

    clear(): void {
        this.values.clear();
        this.valueKinds.clear();
        this.clientInputSymbols.clear();
    }
}
