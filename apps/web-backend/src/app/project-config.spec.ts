import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Playwright web-backend launch', () => {
    const appsDirectory = join(process.cwd(), 'apps');
    const launchCommand = 'node --import tsx apps/web-backend/src/main.ts';
    const configsStartingBackend = ['apps/web-e2e/playwright.config.ts'];
    const readSource = (path: string) =>
        readFileSync(join(process.cwd(), path), 'utf8');
    const serveEnv = (
        JSON.parse(readSource('apps/web-backend/project.json')) as {
            targets: { serve: { options: { env: Record<string, string> } } };
        }
    ).targets.serve.options.env;

    it('knows every Playwright config that starts the web backend', () => {
        const configs = readdirSync(appsDirectory, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .flatMap((entry) =>
                readdirSync(join(appsDirectory, entry.name))
                    .filter((name) =>
                        /^playwright(\..+)?\.config\.ts$/.test(name)
                    )
                    .map((name) => `apps/${entry.name}/${name}`)
            )
            .filter((configPath) =>
                readSource(configPath).includes('web-backend')
            );

        expect(configs.sort()).toEqual(configsStartingBackend);
    });

    // Nx starts a run-commands child in its own detached process group, and
    // Playwright stops a webServer with a process-group SIGKILL, so a backend
    // launched through Nx outlived the run and kept port 3333.
    it.each(configsStartingBackend)(
        'starts the backend in %s as a single node process',
        (configPath) => {
            const source = readSource(configPath);
            const start = source.indexOf(`'${launchCommand}'`);

            expect(source).not.toMatch(/\bnx\b[^'"`\n]*web-backend/);
            expect(start).toBeGreaterThan(-1);
            expect(
                source.indexOf(launchCommand, start + launchCommand.length)
            ).toBe(-1);

            // WEB_BACKEND_PORT relocates the run; its default is the target's.
            const { PORT: port, ...fixedEnv } = serveEnv;
            const entry = source.slice(start, source.indexOf('url:', start));
            for (const [name, value] of Object.entries(fixedEnv)) {
                expect(entry).toContain(`${name}: '${value}'`);
            }
            expect(source).toContain(
                `process.env['WEB_BACKEND_PORT'] ?? '${port}'`
            );
            expect(entry).toContain('PORT: webBackendPort,');
            expect(source).toContain(
                'url: `http://localhost:${webBackendPort}/health`'
            );
        }
    );
});
