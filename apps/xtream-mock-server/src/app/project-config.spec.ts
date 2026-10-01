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

describe('Nx E2E task dependencies', () => {
    type Dependency =
        | string
        | {
              projects?: string | string[];
              dependencies?: boolean;
              target?: string;
          };
    type TargetConfig = {
        dependsOn?: Dependency[];
        continuous?: boolean;
        filter?: { projects?: string[] };
    };
    type ProjectJson = { targets: Record<string, TargetConfig> };
    const readJson = <T>(path: string) =>
        JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as T;
    const nxJson = readJson<{
        targetDefaults: Record<string, TargetConfig | TargetConfig[]>;
    }>('nx.json');
    const appNames = readdirSync(join(process.cwd(), 'apps'));
    const e2eProjectFiles = appNames
        .filter((name) => name.endsWith('-e2e'))
        .map((name) => `apps/${name}/project.json`);
    // The E2E projects list the mocks as implicit dependencies, so a `^serve`
    // dependency schedules the mock serve tasks as well.
    const mockContinuousTargets = new Set(
        appNames
            .filter((name) => name.endsWith('-mock-server'))
            .flatMap((name) =>
                Object.entries(
                    readJson<ProjectJson>(`apps/${name}/project.json`).targets
                )
                    .filter(([, target]) => target.continuous)
                    .map(([targetName]) => targetName)
            )
    );
    const dependsOnMock = (dependency: Dependency) =>
        typeof dependency === 'string'
            ? dependency.includes('-mock-server:') ||
              (dependency.startsWith('^') &&
                  mockContinuousTargets.has(dependency.slice(1)))
            : [dependency.projects ?? []]
                  .flat()
                  .some((project) => project.includes('-mock-server')) ||
              (dependency.dependencies === true &&
                  mockContinuousTargets.has(dependency.target ?? ''));
    const perFileDefaultFor = (project: string) =>
        [nxJson.targetDefaults['e2e-ci--src/*.e2e.ts'] ?? []]
            .flat()
            .find((entry) => entry.filter?.projects?.includes(project));

    // The Playwright configs start the mocks themselves, so @nx/playwright
    // infers their E2E targets as non-parallel, and Nx refuses to run a
    // non-parallel task that depends on a continuous `serve` task.
    it('never makes an E2E target depend on a mock-server task', () => {
        const e2eDefaults = Object.entries(nxJson.targetDefaults)
            .filter(([targetName]) => targetName.startsWith('e2e'))
            .flatMap(([targetName, config]) =>
                [config].flat().map((entry) => ({
                    source: `nx.json ${targetName}`,
                    config: entry,
                }))
            );
        const e2eProjectTargets = e2eProjectFiles.flatMap((path) =>
            Object.entries(readJson<ProjectJson>(path).targets).map(
                ([targetName, config]) => ({
                    source: `${path} ${targetName}`,
                    config,
                })
            )
        );
        const mockDependencies = [...e2eDefaults, ...e2eProjectTargets]
            .map(({ source, config }) => ({
                source,
                dependencies: (config.dependsOn ?? []).filter(dependsOnMock),
            }))
            .filter(({ dependencies }) => dependencies.length > 0);

        expect(e2eProjectFiles).toEqual(
            expect.arrayContaining([
                'apps/electron-backend-e2e/project.json',
                'apps/web-e2e/project.json',
            ])
        );
        expect([...mockContinuousTargets]).toContain('serve');
        expect(mockDependencies).toEqual([]);
    });

    it('builds the Electron app only before Electron per-file E2E targets', () => {
        expect(perFileDefaultFor('electron-backend-e2e')?.dependsOn).toEqual([
            { projects: ['electron-backend'], target: 'build-e2e' },
        ]);
        expect(perFileDefaultFor('web-e2e')?.dependsOn).toEqual([]);
    });
});
