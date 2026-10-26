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

        expect(configs.sort()).toEqual(
            [
                ...configsStartingBackend,
                'apps/tv-e2e/playwright.config.ts',
            ].sort()
        );
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
            // One stateless backend, plus at most one storage-enabled one.
            const second = source.indexOf(
                `'${launchCommand}'`,
                start + launchCommand.length
            );
            if (second !== -1) {
                const storageEntry = source.slice(
                    second,
                    source.indexOf('url:', second)
                );
                expect(storageEntry).toContain(`IPTVNATOR_STORAGE: 'server'`);
                expect(storageEntry).toContain('PORT: storageBackendPort,');
                expect(
                    source.indexOf(
                        `'${launchCommand}'`,
                        second + launchCommand.length
                    )
                ).toBe(-1);
            }

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
    it('keeps TV backend launch isolated and packages the mobile companion', () => {
        const source = readSource('apps/tv-e2e/playwright.config.ts');
        expect(source.split(launchCommand)).toHaveLength(3);
        const ports = readSource('apps/tv-e2e/ports.ts');
        expect(ports).toContain("process.env['TV_E2E_PORT_OFFSET'] ?? 0");
        for (const [name, port] of Object.entries({
            app: 4311,
            backend: 3433,
            library: 3434,
        })) {
            expect(ports).toContain(`${name}: ${port} + offset`);
        }
        expect(source).toContain('PORT: String(tvPorts.library)');
        expect(source).toContain('url: `${tvOrigins.library}/health`');
        expect(source).toContain("IPTVNATOR_STORAGE: 'server'");
        expect(source).toContain("IPTVNATOR_ACCESS_TOKEN: 'tv-library-test'");
        expect(source).not.toMatch(/\bnx\b[^'"`\n]*web-backend/);
        expect(source).toContain('PORT: String(tvPorts.backend)');
        expect(source).toContain('url: `${tvOrigins.backend}/health`');
        expect(source).toContain('CLIENT_URL: `${tvOrigins.app},null`');
        expect(source).toContain("TSX_TSCONFIG_PATH: 'tsconfig.base.json'");
        const project = JSON.parse(readSource('apps/web-backend/project.json'));
        expect(project.targets.build.dependsOn).toContainEqual({
            target: 'build',
            projects: ['tv-setup'],
        });
        expect(project.targets.build.options.assets).toContainEqual({
            input: 'dist/apps/tv-setup',
            glob: '**/*',
            output: 'tv-setup',
        });
        expect(project.targets.build.options.includeIgnoredAssetFiles).toBe(
            true
        );
    });
});
