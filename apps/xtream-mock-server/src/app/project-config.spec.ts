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
            for (const mock of mocks) {
                expect(source).toContain(
                    `'node --import tsx apps/${mock}-mock-server/src/main.ts'`
                );
            }
            expect(
                source.match(/node --import tsx apps\/[\w-]+-mock-server\//g)
            ).toHaveLength(mocks.length);
            expect(
                source.match(/TSX_TSCONFIG_PATH: 'tsconfig\.base\.json'/g)
            ).toHaveLength(mocks.length);
        }
    );
});
