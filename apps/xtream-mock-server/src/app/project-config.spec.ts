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
    const playwrightConfigs = readdirSync(appsDirectory, {
        withFileTypes: true,
    })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) =>
            readdirSync(join(appsDirectory, entry.name))
                .filter((name) => /^playwright(\..+)?\.config\.ts$/.test(name))
                .map((name) => `apps/${entry.name}/${name}`)
        );

    it('finds every config that starts a mock server', () => {
        expect(playwrightConfigs).toEqual(
            expect.arrayContaining([
                'apps/electron-backend-e2e/playwright.config.ts',
                'apps/electron-backend-e2e/playwright.journeys.config.ts',
                'apps/electron-backend-e2e/playwright.xtream-performance.config.ts',
                'apps/web-e2e/playwright.config.ts',
            ])
        );
    });

    // Nx starts a run-commands child in its own detached process group, and
    // Playwright stops a webServer with a process-group SIGKILL, so a mock
    // launched through `nx run …:serve` outlived the run and kept its port.
    it.each(playwrightConfigs)(
        'starts mock servers as a single node process in %s',
        (configPath) => {
            const source = readFileSync(
                join(process.cwd(), configPath),
                'utf8'
            );

            expect(source).not.toMatch(/nx run [\w-]+-mock-server:serve/);
            const launches =
                source.match(/node --import tsx apps\/[\w-]+-mock-server\//g) ??
                [];
            const tsconfigs =
                source.match(/TSX_TSCONFIG_PATH: 'tsconfig\.base\.json'/g) ??
                [];
            expect(tsconfigs).toHaveLength(launches.length);
        }
    );
});
