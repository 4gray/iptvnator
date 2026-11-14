import type { WebContents } from 'electron';
import { releaseRequestHeaderOwner } from './request-header-overrides.service';

/**
 * Named header owners (multiview tiles) by the page that configured them.
 * The renderer releases an owner when its tile goes, but a reload, a crash
 * or a closed window skips that teardown; the page's owners are released
 * here instead, so a tile's User-Agent, Cookie or Authorization never
 * reaches requests of the page that comes after it.
 */
const ownersBySender = new Map<number, Set<string>>();
const senderCleanups = new Map<number, () => void>();

/** Ties `ownerId` to the page in `sender` until the owner or page goes. */
export function trackRequestHeaderOwner(
    sender: WebContents,
    ownerId: string
): void {
    let owners = ownersBySender.get(sender.id);
    if (!owners) {
        owners = new Set();
        ownersBySender.set(sender.id, owners);
        watchSenderLifetime(sender);
    }
    owners.add(ownerId);
}

/** The renderer released `ownerId` itself. */
export function untrackRequestHeaderOwner(
    senderId: number,
    ownerId: string
): void {
    ownersBySender.get(senderId)?.delete(ownerId);
}

/** Test-only: forget every page without releasing owners. */
export function resetRequestHeaderOwnerLifetimeForTesting(): void {
    for (const cleanup of senderCleanups.values()) cleanup();
    senderCleanups.clear();
    ownersBySender.clear();
}

function watchSenderLifetime(sender: WebContents): void {
    const senderId = sender.id;
    const release = () => releaseSender(senderId);
    const onNavigation = (
        event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>
    ) => {
        // A main-frame load replaces the page; Angular routing keeps it.
        if (event.isMainFrame && !event.isSameDocument) release();
    };
    sender.on('destroyed', release);
    sender.on('render-process-gone', release);
    sender.on('did-start-navigation', onNavigation);
    senderCleanups.set(senderId, () => {
        sender.off('destroyed', release);
        sender.off('render-process-gone', release);
        sender.off('did-start-navigation', onNavigation);
    });
}

function releaseSender(senderId: number): void {
    for (const owner of ownersBySender.get(senderId) ?? []) {
        releaseRequestHeaderOwner(owner);
    }
    ownersBySender.delete(senderId);
    senderCleanups.get(senderId)?.();
    senderCleanups.delete(senderId);
}
