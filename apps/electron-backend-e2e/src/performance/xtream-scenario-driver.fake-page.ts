import type { Page } from '@playwright/test';

export class FakeXtreamScenarioPage {
    readonly log: string[] = [];
    operationSnapshot: unknown = null;
    readonly operationSnapshots: unknown[] = [];
    readonly asPageReference: Page;
    cancellationSnapshot: Record<string, unknown> = {
        armedEpochMs: 100,
        clickEpochMs: 201,
        current: 1_000,
        operationId: 'save-content-1',
        progressEpochMs: 200,
        threshold: 1_000,
        total: 10_000,
    };

    constructor() {
        this.asPageReference = this.createPage();
    }

    asPage(): Page {
        return this.asPageReference;
    }

    clicksMatching(fragment: string): number {
        return this.log.filter(
            (entry) => entry.startsWith('click:') && entry.includes(fragment)
        ).length;
    }

    private createPage(): Page {
        return {
            evaluate: async (_callback: unknown, argument: unknown) => {
                const command = recordValue(argument, 'command');
                this.log.push(`evaluate:${String(command)}`);
                if (command === 'snapshot-operation') {
                    return (
                        this.operationSnapshots.shift() ??
                        this.operationSnapshot
                    );
                }
                if (command === 'snapshot-cancellation') {
                    return this.cancellationSnapshot;
                }
                return undefined;
            },
            getByRole: (role: string, options?: unknown) =>
                new FakeLocator(
                    this,
                    `page.role(${role};${roleOptions(options)})`
                ),
            locator: (selector: string) => new FakeLocator(this, selector),
            waitForFunction: async (_callback: unknown, argument: unknown) => {
                this.log.push(
                    `waitForFunction:${String(
                        recordValue(argument, 'waitFor')
                    )}`
                );
            },
            waitForURL: async (url: unknown) => {
                this.log.push(`waitForURL:${String(url)}`);
            },
        } as unknown as Page;
    }
}

class FakeLocator {
    constructor(
        private readonly page: FakeXtreamScenarioPage,
        private readonly path: string
    ) {}

    first(): FakeLocator {
        return new FakeLocator(this.page, `${this.path}.first`);
    }

    last(): FakeLocator {
        return new FakeLocator(this.page, `${this.path}.last`);
    }

    filter(options: unknown): FakeLocator {
        return new FakeLocator(
            this.page,
            `${this.path}.filter(${String(recordValue(options, 'hasText'))})`
        );
    }

    getByRole(role: string, options?: unknown): FakeLocator {
        return new FakeLocator(
            this.page,
            `${this.path}.role(${role};${roleOptions(options)})`
        );
    }

    locator(selector: string): FakeLocator {
        return new FakeLocator(this.page, `${this.path} >> ${selector}`);
    }

    async click(): Promise<void> {
        this.page.log.push(`click:${this.path}`);
    }

    async count(): Promise<number> {
        return 1;
    }

    async fill(value: string): Promise<void> {
        const selector = this.path.split(' >> ').at(-1) ?? this.path;
        this.page.log.push(`fill:${selector}:${value}`);
    }

    async isDisabled(): Promise<boolean> {
        return false;
    }

    async waitFor(options: { readonly state: string }): Promise<void> {
        this.page.log.push(`waitFor:${this.path}:${options.state}`);
    }
}

function recordValue(value: unknown, key: string): unknown {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, key);
}

function roleOptions(value: unknown): string {
    const name = recordValue(value, 'name');
    const exact = recordValue(value, 'exact');
    return `name=${name instanceof RegExp ? name.toString() : String(name)};exact=${String(exact)}`;
}
