import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';

import type { ElectronApplication } from '@playwright/test';

import type { XtreamIterationProcessEvidence } from './xtream-iteration-assembler';
import {
    XTREAM_STARTUP_RETRY_REASON,
    type XtreamStartupRetryReason,
} from './xtream-summary-contract';

export interface XtreamLaunchIdentity {
    readonly electronPid: number;
    readonly launchId: string;
}

export interface XtreamIterationProcessEvidenceOptions extends XtreamLaunchIdentity {
    readonly diagnosticDirectorySha256: string | null;
    readonly iterationDirectory: string;
    readonly startupAttemptCount: number;
    readonly startupRetryReasons: readonly XtreamStartupRetryReason[];
}

export async function captureXtreamLaunchIdentity(
    electronApp: ElectronApplication,
    launcherPid: number | undefined,
    seenElectronPids: Set<number>,
    createUuid: () => string = randomUUID
): Promise<XtreamLaunchIdentity> {
    try {
        const evaluatedPid = await electronApp.evaluate(
            async () => process.pid
        );
        if (
            !Number.isSafeInteger(launcherPid) ||
            Number(launcherPid) <= 0 ||
            evaluatedPid !== launcherPid ||
            seenElectronPids.has(Number(launcherPid))
        ) {
            invalidProcess();
        }
        const launchId = `launch-${createUuid()}`;
        if (!/^launch-[a-f0-9-]{36}$/u.test(launchId)) invalidProcess();
        seenElectronPids.add(Number(launcherPid));
        return Object.freeze({
            electronPid: Number(launcherPid),
            launchId,
        });
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'xtream-electron-process-identity-invalid'
        ) {
            throw error;
        }
        invalidProcess();
    }
}

export async function createXtreamIterationProcessEvidence(
    options: XtreamIterationProcessEvidenceOptions
): Promise<XtreamIterationProcessEvidence> {
    try {
        if (
            !Number.isSafeInteger(options.electronPid) ||
            options.electronPid <= 0 ||
            !/^launch-[a-f0-9-]{36}$/u.test(options.launchId) ||
            !validStartupEvidence(
                options.startupAttemptCount,
                options.startupRetryReasons
            )
        ) {
            invalidProcess();
        }
        const stats = await lstat(options.iterationDirectory);
        if (!stats.isDirectory() || stats.isSymbolicLink()) invalidProcess();
        const canonicalDirectory = await realpath(options.iterationDirectory);
        const pathSha256 = sha256(canonicalDirectory);
        const profileDirectorySha256 =
            options.diagnosticDirectorySha256 === null
                ? pathSha256
                : options.diagnosticDirectorySha256;
        if (!/^[a-f0-9]{64}$/u.test(profileDirectorySha256)) {
            invalidProcess();
        }
        return Object.freeze({
            electronPid: options.electronPid,
            freshProcessVerified: true,
            launchId: options.launchId,
            profileDirectorySha256,
            startupAttemptCount: options.startupAttemptCount as 1 | 2,
            startupRetryReasons: Object.freeze([
                ...options.startupRetryReasons,
            ]),
        });
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'xtream-electron-process-identity-invalid'
        ) {
            throw error;
        }
        invalidProcess();
    }
}

function validStartupEvidence(
    attemptCount: number,
    retryReasons: readonly XtreamStartupRetryReason[]
): boolean {
    return (
        (attemptCount === 1 || attemptCount === 2) &&
        Array.isArray(retryReasons) &&
        retryReasons.length === attemptCount - 1 &&
        retryReasons.every((reason) =>
            Object.values(XTREAM_STARTUP_RETRY_REASON).includes(reason)
        )
    );
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function invalidProcess(): never {
    throw new Error('xtream-electron-process-identity-invalid');
}
