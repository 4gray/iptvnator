#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
    LINUX_SYSTEM_PACKAGE_DEPENDENCIES,
    resolveLinuxFrameCopyProfile,
} = require('./linux-frame-copy-profile.cjs');
const scriptPath = fileURLToPath(import.meta.url);

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function targetName(target) {
    const value =
        typeof target === 'string'
            ? target
            : target && typeof target === 'object'
              ? target.target
              : null;
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(
            'Electron Builder Linux targets must have a non-empty target name.'
        );
    }
    return value.trim().toLowerCase();
}

function targetObject(target) {
    return typeof target === 'string' ? { target } : { ...target };
}

function fpmDependencyName(option) {
    return String(option).match(
        /^--depends(?:=|\s+)([A-Za-z0-9+_.-]+)(?:$|\s|[<>=])/
    )?.[1];
}

function configureSystemDependencies(config) {
    for (const [format, dependencies] of Object.entries(
        LINUX_SYSTEM_PACKAGE_DEPENDENCIES
    )) {
        const frameCopyDependencies = new Set(dependencies);
        const formatConfig = { ...(config[format] ?? {}) };
        const otherFpmOptions = (formatConfig.fpm ?? []).filter(
            (option) => !frameCopyDependencies.has(fpmDependencyName(option))
        );
        formatConfig.fpm = [
            ...otherFpmOptions,
            ...dependencies.map((dependency) => `--depends=${dependency}`),
        ];
        config[format] = formatConfig;
    }
}

function removeForeignFrameCopyDependency(config, format) {
    const dependencies = new Set(
        LINUX_SYSTEM_PACKAGE_DEPENDENCIES[format] ?? []
    );
    const formatConfig = { ...(config[format] ?? {}) };
    const retainedFpmOptions = (formatConfig.fpm ?? []).filter(
        (option) => !dependencies.has(fpmDependencyName(option))
    );
    if (retainedFpmOptions.length > 0) {
        formatConfig.fpm = retainedFpmOptions;
    } else {
        delete formatConfig.fpm;
    }
    config[format] = formatConfig;
}

export function configureLinuxFrameCopyBuild(
    electronBuilderConfig,
    { profileName, foreignDeb = false, foreignArch } = {}
) {
    const hasForeignArch = foreignArch !== undefined;
    if (
        !electronBuilderConfig ||
        typeof electronBuilderConfig !== 'object' ||
        Array.isArray(electronBuilderConfig)
    ) {
        throw new TypeError(
            'Electron Builder configuration must be an object.'
        );
    }
    if (foreignDeb && profileName) {
        throw new Error(
            'The marker-only foreign DEB pass must not select a frame-copy profile.'
        );
    }
    if (hasForeignArch && !foreignDeb) {
        throw new Error(
            'A marker-only foreign architecture requires --foreign-deb.'
        );
    }
    const configured = cloneJson(electronBuilderConfig);
    const targets = configured.linux?.target;
    if (!Array.isArray(targets)) {
        throw new Error('Electron Builder linux.target must be an array.');
    }

    if (foreignDeb) {
        const debTarget = targets.find(
            (target) => targetName(target) === 'deb'
        );
        if (!debTarget) {
            throw new Error(
                'Electron Builder has no DEB target for the foreign-architecture pass.'
            );
        }
        const configuredDebTarget = targetObject(debTarget);
        const configuredArches = Array.isArray(configuredDebTarget.arch)
            ? configuredDebTarget.arch
            : [configuredDebTarget.arch].filter(Boolean);
        const foreignArches = configuredArches.filter(
            (architecture) => architecture !== 'x64'
        );
        if (foreignArches.length === 0) {
            throw new Error(
                'Electron Builder DEB target has no foreign architectures.'
            );
        }
        if (
            hasForeignArch &&
            (typeof foreignArch !== 'string' ||
                !foreignArches.includes(foreignArch))
        ) {
            throw new Error(
                `Unsupported marker-only foreign DEB architecture "${foreignArch}". Expected one of: ${foreignArches.join(
                    ', '
                )}.`
            );
        }
        configuredDebTarget.arch = hasForeignArch
            ? [foreignArch]
            : foreignArches;
        configured.linux.target = [configuredDebTarget];
        configured.directories = {
            ...(configured.directories ?? {}),
            output: 'dist/executables-linux-foreign',
        };
        removeForeignFrameCopyDependency(configured, 'deb');
        return configured;
    }

    const profile = resolveLinuxFrameCopyProfile(profileName);
    const allowedTargets = new Set(profile.targets);
    const targetsByName = new Map(
        profile.targets.map((profileTarget) => [profileTarget, []])
    );
    for (const target of targets) {
        const name = targetName(target);
        if (allowedTargets.has(name)) {
            targetsByName.get(name).push(target);
        }
    }
    const duplicateTargets = profile.targets.filter(
        (profileTarget) => targetsByName.get(profileTarget).length > 1
    );
    const missingTargets = profile.targets.filter(
        (profileTarget) => targetsByName.get(profileTarget).length === 0
    );
    if (duplicateTargets.length > 0 || missingTargets.length > 0) {
        throw new Error(
            [
                `Invalid Electron Builder targets for Linux profile "${profile.name}".`,
                ...(duplicateTargets.length > 0
                    ? [
                          `Found duplicate target "${duplicateTargets.join(
                              '", "'
                          )}".`,
                      ]
                    : []),
                ...(missingTargets.length > 0
                    ? [`Missing targets: ${missingTargets.join(', ')}.`]
                    : []),
            ].join(' ')
        );
    }
    configured.linux.target = profile.targets.map((profileTarget) => {
        const target = targetsByName.get(profileTarget)[0];
        const configuredTarget = targetObject(target);
        if (profile.name === 'system') {
            configuredTarget.arch = ['x64'];
        }
        return configuredTarget;
    });
    if (profile.name === 'system') {
        configureSystemDependencies(configured);
    }
    return configured;
}

function parseArguments(argv) {
    const normalized = argv[0] === '--' ? argv.slice(1) : argv;
    let configPath = 'electron-builder.json';
    let profileName;
    let foreignDeb = false;
    let foreignArch;
    const nextValue = (flag, index) => {
        const value = normalized[index + 1];
        if (
            typeof value !== 'string' ||
            value.trim() === '' ||
            value.startsWith('--')
        ) {
            throw new Error(`${flag} requires a value.`);
        }
        return value;
    };
    for (let index = 0; index < normalized.length; index += 1) {
        const argument = normalized[index];
        if (argument === '--config') {
            configPath = nextValue(argument, index);
            index += 1;
        } else if (argument === '--profile') {
            profileName = nextValue(argument, index);
            index += 1;
        } else if (argument === '--foreign-deb') {
            foreignDeb = true;
        } else if (argument === '--foreign-arch') {
            foreignArch = nextValue(argument, index);
            index += 1;
        } else {
            throw new Error(`Unsupported configurator argument: ${argument}`);
        }
    }
    if (!foreignDeb && !profileName) {
        throw new Error('--profile or --foreign-deb is required.');
    }
    return {
        configPath: path.resolve(configPath),
        profileName,
        foreignDeb,
        foreignArch,
    };
}

function main() {
    const options = parseArguments(process.argv.slice(2));
    const config = JSON.parse(fs.readFileSync(options.configPath, 'utf8'));
    const configured = configureLinuxFrameCopyBuild(config, options);
    fs.writeFileSync(
        options.configPath,
        `${JSON.stringify(configured, null, 4)}\n`
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    try {
        main();
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
    }
}
