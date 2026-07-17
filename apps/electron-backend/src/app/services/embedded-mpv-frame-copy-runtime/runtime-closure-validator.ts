import { isDeepStrictEqual } from 'util';
import {
    ALLOWED_EXTERNAL_LIBRARY_NAMES,
    EXPECTED_EXTERNAL_SYSTEM_LIBRARIES,
    SAFE_RUNTIME_NAME_PATTERN,
    SHARED_LIBRARY_PATTERN,
} from './contracts';
import type { RuntimeFile } from './types';
import {
    hasExactFields,
    isObject,
    isSafeRuntimeName,
} from './validation-primitives';

export function validateRuntimeClosure(
    value: unknown,
    runtimeFiles: RuntimeFile[],
    libmpvSoname: string,
    externalSystemLibraries: unknown
): boolean {
    if (
        !isDeepStrictEqual(
            externalSystemLibraries,
            EXPECTED_EXTERNAL_SYSTEM_LIBRARIES
        ) ||
        !isObject(value) ||
        !hasExactFields(value, ['entries', 'externalDependencies']) ||
        !Array.isArray(value.entries) ||
        !Array.isArray(value.externalDependencies) ||
        value.externalDependencies.some(
            (dependency) =>
                typeof dependency !== 'string' ||
                !SAFE_RUNTIME_NAME_PATTERN.test(dependency) ||
                !SHARED_LIBRARY_PATTERN.test(dependency)
        )
    ) {
        return false;
    }

    const runtimeNames = runtimeFiles.map(({ name }) => name);
    const runtimeNameSet = new Set(runtimeNames);
    const closureNames: string[] = [];
    const computedExternalDependencies = new Set<string>();
    for (const entry of value.entries) {
        if (
            !isObject(entry) ||
            !hasExactFields(entry, [
                'name',
                'needed',
                'rpath',
                'runpath',
                'soname',
            ]) ||
            !isSafeRuntimeName(entry.name) ||
            (entry.soname !== null && !isSafeRuntimeName(entry.soname)) ||
            !Array.isArray(entry.needed) ||
            entry.needed.some(
                (dependency) =>
                    typeof dependency !== 'string' ||
                    !SAFE_RUNTIME_NAME_PATTERN.test(dependency) ||
                    !SHARED_LIBRARY_PATTERN.test(dependency)
            ) ||
            !isDeepStrictEqual(entry.rpath, []) ||
            !isDeepStrictEqual(entry.runpath, ['$ORIGIN']) ||
            new Set(entry.needed).size !== entry.needed.length ||
            !isDeepStrictEqual([...entry.needed].sort(), entry.needed)
        ) {
            return false;
        }
        closureNames.push(entry.name);
        for (const dependency of entry.needed) {
            if (runtimeNameSet.has(dependency)) {
                continue;
            }
            if (!ALLOWED_EXTERNAL_LIBRARY_NAMES.has(dependency)) {
                return false;
            }
            computedExternalDependencies.add(dependency);
        }
    }

    const linkerAlias = value.entries.find(
        (entry) => isObject(entry) && entry.name === 'libmpv.so'
    );
    return (
        isDeepStrictEqual(closureNames, runtimeNames) &&
        new Set(closureNames).size === closureNames.length &&
        isDeepStrictEqual(
            value.externalDependencies,
            [...computedExternalDependencies].sort()
        ) &&
        isObject(linkerAlias) &&
        linkerAlias.soname === libmpvSoname
    );
}
