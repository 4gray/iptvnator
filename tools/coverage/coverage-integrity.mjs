import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');

export const COVERAGE_COLLECTION_FAILURE = 'Failed to collect coverage';
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const COVERAGE_METRICS = [
    'statements',
    'branches',
    'functions',
    'lines',
];

function toPosix(filePath) {
    return filePath.split(path.sep).join('/');
}

function hasDeclareModifier(statement) {
    const modifiers = ts.canHaveModifiers(statement)
        ? (ts.getModifiers(statement) ?? [])
        : [];
    return modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword
    );
}

export function hasRuntimeOwnedStatement(sourceText, fileName = 'source.ts') {
    const source = ts.createSourceFile(
        fileName,
        sourceText,
        ts.ScriptTarget.Latest,
        true
    );

    return source.statements.some((statement) => {
        if (hasDeclareModifier(statement)) {
            return false;
        }

        return !(
            ts.isImportDeclaration(statement) ||
            ts.isImportEqualsDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isExportDeclaration(statement) ||
            ts.isEmptyStatement(statement)
        );
    });
}

export function createCoverageOutputScanner(maxCharacters = 4096) {
    let tail = '';
    let collectionFailed = false;
    let ansiState = 'text';

    function stripAnsi(chunk) {
        const input = String(chunk).replace(ANSI_ESCAPE, '');
        let output = '';

        for (let index = 0; index < input.length; index += 1) {
            const character = input[index];
            const code = character.charCodeAt(0);

            if (ansiState === 'text') {
                if (code === 0x1b) {
                    ansiState = 'escape';
                } else {
                    output += character;
                }
                continue;
            }

            if (ansiState === 'escape') {
                if (character === '[') {
                    ansiState = 'parameters';
                } else {
                    output += '\u001b';
                    ansiState = 'text';
                    index -= 1;
                }
                continue;
            }

            if (ansiState === 'parameters') {
                if (code >= 0x30 && code <= 0x3f) {
                    continue;
                }
                if (code >= 0x20 && code <= 0x2f) {
                    ansiState = 'intermediates';
                    continue;
                }
                if (code >= 0x40 && code <= 0x7e) {
                    ansiState = 'text';
                    continue;
                }

                ansiState = 'text';
                index -= 1;
                continue;
            }

            if (code >= 0x20 && code <= 0x2f) {
                continue;
            }
            if (code >= 0x40 && code <= 0x7e) {
                ansiState = 'text';
                continue;
            }

            ansiState = 'text';
            index -= 1;
        }

        return output;
    }

    return {
        get collectionFailed() {
            return collectionFailed;
        },
        get tail() {
            return tail;
        },
        push(chunk) {
            const output = `${tail}${stripAnsi(chunk)}`;
            if (output.includes(COVERAGE_COLLECTION_FAILURE)) {
                collectionFailed = true;
            }
            tail = output.slice(-maxCharacters);
        },
    };
}

function isExcludedSource(filePath) {
    const file = toPosix(filePath);
    return (
        /\.(spec|test)\.ts$/.test(file) ||
        file.endsWith('.d.ts') ||
        file.endsWith('/test-setup.ts') ||
        file.includes('/test-stubs/') ||
        /\.generated\./.test(file) ||
        file.includes('/environments/') ||
        file.endsWith('/index.ts')
    );
}

function runtimeOwningSourceFiles(workspaceRoot, sourceRoot) {
    const absoluteSourceRoot = path.resolve(workspaceRoot, sourceRoot);
    const runtimeFiles = [];
    const directories = [absoluteSourceRoot];

    while (directories.length > 0) {
        const directory = directories.pop();
        for (const name of readdirSync(directory)) {
            const filePath = path.join(directory, name);
            const stats = statSync(filePath);

            if (stats.isDirectory()) {
                directories.push(filePath);
                continue;
            }
            if (
                !stats.isFile() ||
                !filePath.endsWith('.ts') ||
                isExcludedSource(filePath)
            ) {
                continue;
            }
            if (
                hasRuntimeOwnedStatement(
                    readFileSync(filePath, 'utf8'),
                    filePath
                )
            ) {
                runtimeFiles.push(path.resolve(filePath));
            }
        }
    }

    return runtimeFiles.sort();
}

function isObjectRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function indexCoverageFilesByAbsolutePath(coverageMap, workspaceRoot) {
    const filesByAbsolutePath = new Map();
    const duplicateAbsolutePaths = new Set();

    for (const reportedPath of coverageMap.files().sort()) {
        const absolutePath = path.resolve(workspaceRoot, reportedPath);
        if (filesByAbsolutePath.has(absolutePath)) {
            duplicateAbsolutePaths.add(absolutePath);
            continue;
        }
        filesByAbsolutePath.set(absolutePath, reportedPath);
    }

    return {
        duplicateAbsolutePaths: [...duplicateAbsolutePaths].sort(),
        filesByAbsolutePath,
    };
}

export function validateProjectCoverage({ workspaceRoot, project }) {
    const reportPath = path.resolve(
        workspaceRoot,
        'coverage',
        project.root,
        'coverage-final.json'
    );
    const relativeReportPath = toPosix(
        path.relative(workspaceRoot, reportPath)
    );

    if (!existsSync(reportPath)) {
        return {
            errors: [
                `${project.name} did not produce ${relativeReportPath}.`,
            ],
            report: undefined,
        };
    }

    let data;
    try {
        data = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (error) {
        return {
            errors: [
                `${project.name} coverage report ${relativeReportPath} contains invalid JSON: ${error.message}`,
            ],
            report: undefined,
        };
    }

    if (
        !isObjectRecord(data) ||
        Object.values(data).some((entry) => !isObjectRecord(entry))
    ) {
        return {
            errors: [
                `${project.name} coverage report ${relativeReportPath} must contain a JSON object mapping source paths to JSON objects.`,
            ],
            report: undefined,
        };
    }

    let coverageMap;
    try {
        coverageMap = createCoverageMap(data);
        for (const filePath of coverageMap.files()) {
            coverageMap.fileCoverageFor(filePath).toSummary();
        }
    } catch (error) {
        return {
            errors: [
                `${project.name} coverage report ${relativeReportPath} is not valid Istanbul coverage: ${error.message}`,
            ],
            report: undefined,
        };
    }

    const {
        duplicateAbsolutePaths,
        filesByAbsolutePath: reportedFiles,
    } = indexCoverageFilesByAbsolutePath(coverageMap, workspaceRoot);
    if (duplicateAbsolutePaths.length > 0) {
        return {
            errors: duplicateAbsolutePaths.map(
                (filePath) =>
                    `${project.name} coverage report ${relativeReportPath} contains a duplicate entry for ${toPosix(
                        path.relative(workspaceRoot, filePath)
                    )} after path normalization.`
            ),
            report: undefined,
        };
    }

    const errors = [];
    for (const filePath of runtimeOwningSourceFiles(
        workspaceRoot,
        project.sourceRoot
    )) {
        const reportedPath = reportedFiles.get(filePath);
        const relativeSourcePath = toPosix(
            path.relative(workspaceRoot, filePath)
        );
        if (reportedPath === undefined) {
            errors.push(
                `${project.name} coverage report is missing runtime-owning source ${relativeSourcePath}.`
            );
            continue;
        }

        const summary = coverageMap
            .fileCoverageFor(reportedPath)
            .toSummary()
            .toJSON();
        const hasUsableInstrumentation = [
            summary.statements,
            summary.functions,
            summary.branches,
        ].some((metric) => metric.total > 0);
        if (!hasUsableInstrumentation) {
            errors.push(
                `${project.name} coverage report ${relativeReportPath} has no usable instrumentation for runtime-owning source ${relativeSourcePath}.`
            );
        }
    }

    return {
        errors,
        report: {
            data,
            path: reportPath,
            project,
        },
    };
}

export function validateRequiredProjectReports({ projects, workspaceRoot }) {
    const errors = [];
    const reports = [];

    for (const project of projects) {
        const result = validateProjectCoverage({ project, workspaceRoot });
        errors.push(...result.errors);
        if (result.report) {
            reports.push(result.report);
        }
    }

    return { errors, reports };
}

function formatConfigurationValue(value) {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function validateCoverageRatchetConfiguration(ratchet) {
    const errors = [];

    for (const metric of COVERAGE_METRICS) {
        const value = ratchet?.merged?.[metric];
        if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 100
        ) {
            errors.push(
                `Invalid coverage ratchet merged.${metric}: expected a finite number between 0 and 100, received ${formatConfigurationValue(value)}.`
            );
        }
    }

    const criticalFiles = ratchet?.criticalFiles;
    if (!Array.isArray(criticalFiles)) {
        errors.push(
            `Invalid coverage ratchet criticalFiles: expected an array, received ${formatConfigurationValue(criticalFiles)}.`
        );
        return errors;
    }

    for (const [index, criticalFile] of criticalFiles.entries()) {
        const criticalPath = criticalFile?.path;
        const hasValidPath =
            typeof criticalPath === 'string' &&
            criticalPath.trim().length > 0;
        if (!hasValidPath) {
            errors.push(
                `Invalid coverage ratchet criticalFiles[${index}].path: expected a non-empty string, received ${formatConfigurationValue(criticalPath)}.`
            );
        }
        const filePath = hasValidPath
            ? toPosix(criticalPath)
            : `criticalFiles[${index}]`;
        const minimumCovered =
            criticalFile?.statements?.minimumCovered;
        if (
            typeof minimumCovered !== 'number' ||
            !Number.isFinite(minimumCovered) ||
            !Number.isInteger(minimumCovered) ||
            minimumCovered < 0
        ) {
            errors.push(
                `Invalid coverage ratchet ${filePath} statements.minimumCovered: expected a non-negative integer, received ${formatConfigurationValue(minimumCovered)}.`
            );
        }

        const minimumPercent =
            criticalFile?.statements?.minimumPercent;
        if (
            typeof minimumPercent !== 'number' ||
            !Number.isFinite(minimumPercent) ||
            minimumPercent < 0 ||
            minimumPercent > 100
        ) {
            errors.push(
                `Invalid coverage ratchet ${filePath} statements.minimumPercent: expected a finite number between 0 and 100, received ${formatConfigurationValue(minimumPercent)}.`
            );
        }
    }

    return errors;
}

export function evaluateCoverageRatchets({
    coverageData,
    mergedSummary,
    ratchet,
    workspaceRoot,
}) {
    const configurationErrors =
        validateCoverageRatchetConfiguration(ratchet);
    if (configurationErrors.length > 0) {
        return configurationErrors;
    }

    const errors = [];

    for (const metric of COVERAGE_METRICS) {
        const required = ratchet.merged[metric];
        const observed = mergedSummary[metric]?.pct;
        if (!Number.isFinite(observed) || observed < required) {
            errors.push(
                `Merged ${metric} coverage regressed: observed ${observed}%, required at least ${required}%.`
            );
        }
    }

    const coverageMap = createCoverageMap(coverageData);
    const {
        duplicateAbsolutePaths,
        filesByAbsolutePath: reportedFiles,
    } = indexCoverageFilesByAbsolutePath(coverageMap, workspaceRoot);
    if (duplicateAbsolutePaths.length > 0) {
        return [
            ...errors,
            ...duplicateAbsolutePaths.map(
                (filePath) =>
                    `Merged coverage contains a duplicate entry for ${toPosix(
                        path.relative(workspaceRoot, filePath)
                    )} after path normalization.`
            ),
        ];
    }

    for (const criticalFile of ratchet.criticalFiles) {
        const filePath = path.resolve(workspaceRoot, criticalFile.path);
        const relativePath = toPosix(path.relative(workspaceRoot, filePath));
        const reportedPath = reportedFiles.get(filePath);
        if (reportedPath === undefined) {
            errors.push(
                `Critical coverage ${relativePath} is missing from merged coverage.`
            );
            continue;
        }

        const statements = coverageMap
            .fileCoverageFor(reportedPath)
            .toSummary()
            .toJSON().statements;
        const minimumCovered = criticalFile.statements.minimumCovered;
        if (statements.covered < minimumCovered) {
            errors.push(
                `Critical coverage ${relativePath} statements covered regressed: observed ${statements.covered}, required at least ${minimumCovered}.`
            );
        }

        const minimumPercent = criticalFile.statements.minimumPercent;
        if (statements.pct < minimumPercent) {
            errors.push(
                `Critical coverage ${relativePath} statements percent regressed: observed ${statements.pct}%, required at least ${minimumPercent}%.`
            );
        }
    }

    return errors;
}
