import { readFileSync } from 'node:fs';
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
