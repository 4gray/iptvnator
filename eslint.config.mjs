import nx from '@nx/eslint-plugin';

const legacyBareAliases = [
    'components',
    'm3u-state',
    'm3u-utils',
    'services',
    'shared-interfaces',
    'shared-portals',
    'remote-control',
    'database',
    'database-schema',
    'database-path-utils',
    'workspace-dashboard-feature',
    'workspace-dashboard-data-access',
];

export default [
    ...nx.configs['flat/base'],
    ...nx.configs['flat/typescript'],
    ...nx.configs['flat/javascript'],
    {
        ignores: ['**/dist'],
    },
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
        rules: {
            '@nx/enforce-module-boundaries': [
                'error',
                {
                    enforceBuildableLibDependency: true,
                    allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
                    depConstraints: [
                        {
                            sourceTag: 'type:app',
                            onlyDependOnLibsWithTags: [
                                'type:feature',
                                'type:ui',
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:e2e',
                            onlyDependOnLibsWithTags: [
                                'type:feature',
                                'type:ui',
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:dev-app',
                            onlyDependOnLibsWithTags: [
                                'type:feature',
                                'type:ui',
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:website',
                            onlyDependOnLibsWithTags: ['type:ui', 'type:util'],
                        },
                        {
                            sourceTag: 'type:feature',
                            onlyDependOnLibsWithTags: [
                                'type:feature',
                                'type:ui',
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:ui',
                            onlyDependOnLibsWithTags: [
                                'type:ui',
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:data-access',
                            onlyDependOnLibsWithTags: [
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:util',
                            onlyDependOnLibsWithTags: ['type:util'],
                        },
                        {
                            sourceTag: 'domain:portal-shared',
                            onlyDependOnLibsWithTags: [
                                'domain:portal-shared',
                                'domain:m3u',
                                'domain:playback',
                                'domain:shared-contracts',
                                'domain:shared-runtime',
                                'domain:shared-ui',
                                'scope:shared',
                                'scope:portal',
                            ],
                        },
                        {
                            sourceTag: 'domain:m3u',
                            onlyDependOnLibsWithTags: [
                                'domain:m3u',
                                'domain:playback',
                                'domain:portal-shared',
                                'domain:shared-contracts',
                                'domain:shared-runtime',
                                'domain:shared-ui',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:playlist-import',
                            onlyDependOnLibsWithTags: [
                                'domain:m3u',
                                'domain:playlist-import',
                                'domain:playback',
                                'domain:shared-contracts',
                                'domain:shared-runtime',
                                'domain:shared-ui',
                                'domain:stalker',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:playback',
                            onlyDependOnLibsWithTags: [
                                'domain:m3u',
                                'domain:playback',
                                'domain:portal-shared',
                                'domain:shared-contracts',
                                'domain:shared-runtime',
                                'domain:shared-ui',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:shared-contracts',
                            onlyDependOnLibsWithTags: [
                                'domain:shared-contracts',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:shared-runtime',
                            onlyDependOnLibsWithTags: [
                                'domain:m3u',
                                'domain:shared-contracts',
                                'domain:shared-runtime',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:shared-ui',
                            onlyDependOnLibsWithTags: [
                                'domain:m3u',
                                'domain:playback',
                                'domain:portal-shared',
                                'domain:shared-contracts',
                                'domain:shared-runtime',
                                'domain:shared-ui',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:xtream',
                            onlyDependOnLibsWithTags: [
                                'domain:xtream',
                                'domain:portal-shared',
                                'domain:m3u',
                                'domain:playback',
                                'domain:shared-contracts',
                                'domain:shared-runtime',
                                'domain:shared-ui',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:stalker',
                            onlyDependOnLibsWithTags: [
                                'domain:stalker',
                                'domain:portal-shared',
                                'domain:m3u',
                                'domain:playback',
                                'domain:shared-contracts',
                                'domain:shared-runtime',
                                'domain:shared-ui',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:workspace',
                            onlyDependOnLibsWithTags: [
                                'domain:workspace',
                                'domain:portal-shared',
                                'domain:xtream',
                                'domain:stalker',
                                'domain:m3u',
                                'domain:playback',
                                'domain:shared-contracts',
                                'domain:shared-runtime',
                                'domain:shared-ui',
                                'scope:shared',
                            ],
                        },
                    ],
                },
            ],
            'no-restricted-imports': [
                'error',
                {
                    paths: legacyBareAliases.map((name) => ({
                        name,
                        message:
                            'Use the scoped @iptvnator/* path alias instead of the legacy bare alias.',
                    })),
                    patterns: legacyBareAliases.map((name) => ({
                        group: [`${name}/*`],
                        message:
                            'Use the scoped @iptvnator/* path alias instead of the legacy bare alias.',
                    })),
                },
            ],
        },
    },
    {
        files: [
            '**/*.ts',
            '**/*.tsx',
            '**/*.cts',
            '**/*.mts',
            '**/*.js',
            '**/*.jsx',
            '**/*.cjs',
            '**/*.mjs',
        ],
        // Override or add rules here
        rules: {
            '@angular-eslint/template/click-events-have-key-events': 'off',
            '@angular-eslint/template/interactive-supports-focus': 'off',
        },
    },
];
