import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Xtream mock Nx serve environment', () => {
    it.each(['serve', 'serve-with-watch'])(
        'lets the caller select PORT for the %s target',
        (targetName) => {
            const project = JSON.parse(
                readFileSync(
                    join(process.cwd(), 'apps/xtream-mock-server/project.json'),
                    'utf8'
                )
            ) as {
                targets: Record<
                    string,
                    { options: { env?: Record<string, string> } }
                >;
            };

            expect(project.targets[targetName]?.options.env).not.toHaveProperty(
                'PORT'
            );
            expect(project.targets[targetName]?.options.env).toMatchObject({
                NODE_ENV: 'development',
            });
        }
    );
});

describe('Playwright mock-server launch', () => {
    const appsDirectory = join(process.cwd(), 'apps');
    const expectedMockLaunches: Record<string, string[]> = {
        'apps/electron-backend-e2e/playwright.config.ts': ['stalker', 'xtream'],
        'apps/electron-backend-e2e/playwright.journeys.config.ts': ['xtream'],
        'apps/electron-backend-e2e/playwright.xtream-performance.config.ts': [
            'xtream',
        ],
        'apps/web-e2e/playwright.config.ts': ['stalker', 'xtream'],
    };
    const readSource = (configPath: string) =>
        readFileSync(join(process.cwd(), configPath), 'utf8');

    it('knows every Playwright config that starts a mock server', () => {
        const configsUsingMocks = readdirSync(appsDirectory, {
            withFileTypes: true,
        })
            .filter((entry) => entry.isDirectory())
            .flatMap((entry) =>
                readdirSync(join(appsDirectory, entry.name))
                    .filter((name) =>
                        /^playwright(\..+)?\.config\.ts$/.test(name)
                    )
                    .map((name) => `apps/${entry.name}/${name}`)
            )
            .filter((configPath) =>
                readSource(configPath).includes('-mock-server')
            );

        expect(configsUsingMocks.sort()).toEqual(
            Object.keys(expectedMockLaunches).sort()
        );
    });

    // Nx starts a run-commands child in its own detached process group, and
    // Playwright stops a webServer with a process-group SIGKILL, so a mock
    // launched through Nx outlived the run and kept its port.
    it.each(Object.entries(expectedMockLaunches))(
        'starts each mock in %s as a single node process',
        (configPath, mocks) => {
            const source = readSource(configPath);

            expect(source).not.toMatch(/\bnx\b[^'"`\n]*mock-server/);
            // Other single-process webServers (web-e2e's web-backend) also set
            // TSX_TSCONFIG_PATH, so check it inside each mock's own entry.
            for (const mock of mocks) {
                const launch = `'node --import tsx apps/${mock}-mock-server/src/main.ts'`;
                const start = source.indexOf(launch);

                expect(start).toBeGreaterThan(-1);
                expect(
                    source.slice(start, source.indexOf('url:', start))
                ).toContain("TSX_TSCONFIG_PATH: 'tsconfig.base.json'");
            }
            expect(
                source.match(/node --import tsx apps\/[\w-]+-mock-server\//g)
            ).toHaveLength(mocks.length);
        }
    );
});

describe('Nx E2E target defaults', () => {
    type DependsOn = Array<string | { projects?: string[]; target?: string }>;
    const nxJson = JSON.parse(
        readFileSync(join(process.cwd(), 'nx.json'), 'utf8')
    ) as {
        targetDefaults: Record<string, { dependsOn?: DependsOn }>;
    };

    // The Playwright configs start the mocks themselves, so @nx/playwright
    // infers the atomized e2e-ci targets as non-parallel, and Nx refuses to
    // run a non-parallel task that depends on a continuous `serve` task.
    it('never makes an E2E target depend on a mock-server task', () => {
        const mockDependencies = Object.entries(nxJson.targetDefaults)
            .flatMap(([targetName, config]) =>
                (config.dependsOn ?? []).map((dependency) => ({
                    targetName,
                    dependency,
                }))
            )
            .filter(({ dependency }) =>
                typeof dependency === 'string'
                    ? dependency.includes('-mock-server:')
                    : (dependency.projects ?? []).some((project) =>
                          project.endsWith('-mock-server')
                      )
            );

        expect(mockDependencies).toEqual([]);
    });

    it('still builds the Electron app before each per-file E2E target', () => {
        expect(
            nxJson.targetDefaults['e2e-ci--src/*.e2e.ts']?.dependsOn
        ).toContainEqual({
            projects: ['electron-backend'],
            target: 'build-e2e',
        });
    });
});
