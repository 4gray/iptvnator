import path from 'node:path';

/** Resolve inferred and explicit targets once, using the same graph as Nx runs. */
export async function readResolvedProjects() {
    const { createProjectGraphAsync } = await import('@nx/devkit');
    const graph = await createProjectGraphAsync({ exitOnError: false });
    // Nx has already applied target defaults and expanded cwd/command tokens.
    return Object.fromEntries(
        Object.entries(graph.nodes).map(([name, node]) => [name, node.data])
    );
}

export function buildCoverageNxArgs({
    project,
    resolvedProject,
    workspaceRoot,
    workers,
}) {
    const target = resolvedProject?.targets?.test;
    if (!target) {
        throw new Error(`Tier A project ${project.name} has no test target.`);
    }
    if (target.executor !== 'nx:run-commands') {
        throw new Error(
            `Tier A project ${project.name} uses unsupported test executor: ${target.executor}`
        );
    }

    // The ESM wrapper uses the shared workspace Jest config; inferred Jest
    // targets and the web app use their project-local Jest configs.
    const mode =
        project.jestRootMode ??
        (target.metadata?.technologies?.includes('jest')
            ? 'project'
            : 'workspace');
    if (mode !== 'workspace' && mode !== 'project') {
        throw new Error(
            `Tier A project ${project.name} has unsupported jestRootMode: ${mode}`
        );
    }
    const sourcePrefix = (
        mode === 'project'
            ? path.relative(project.root, project.sourceRoot)
            : project.sourceRoot
    )
        .split(path.sep)
        .join('/');

    return [
        'nx',
        'run',
        `${project.name}:test`,
        '--output-style=static',
        '--',
        `--maxWorkers=${workers}`,
        '--reporters=default',
        '--reporters=jest-junit',
        '--coverage',
        `--coverageDirectory=${path.join(workspaceRoot, 'coverage', project.root)}`,
        `--collectCoverageFrom=${sourcePrefix}/**/*.{ts,js,mjs,html}`,
        `--collectCoverageFrom=!${sourcePrefix}/**/*.{spec,test}.ts`,
        `--collectCoverageFrom=!${sourcePrefix}/**/test-setup.ts`,
        `--collectCoverageFrom=!${sourcePrefix}/**/test-stubs/**`,
        `--collectCoverageFrom=!${sourcePrefix}/**/*.generated.*`,
        `--collectCoverageFrom=!${sourcePrefix}/**/environments/**`,
        `--collectCoverageFrom=!${sourcePrefix}/**/index.ts`,
    ];
}
