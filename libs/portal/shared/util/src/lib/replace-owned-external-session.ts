import type {
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { isLiveExternalPlayerSession } from './external-playback-button-state';
import { createLogger } from './logger';
import type { PortalExternalPlayback } from './portal-external-playback';

const logger = createLogger('ExternalPlayback');

/**
 * Closes the external session a page owns before it launches a replacement
 * (with instance reuse off a second detached player would start beside it).
 * `owns` names the sessions the page may replace; anything else is left
 * alone. False when teardown could not be confirmed: the caller keeps the
 * running player and cancels the launch.
 */
export async function replaceOwnedExternalSession(
    externalPlayback: Pick<
        PortalExternalPlayback,
        'activeSession' | 'closeSession'
    >,
    owns: (info: PlayerContentInfo) => boolean,
    warn: (message: string, error: unknown) => void = (message, error) =>
        logger.warn(message, error)
): Promise<boolean> {
    const session: ExternalPlayerSession | null =
        externalPlayback.activeSession();
    const info = session?.contentInfo;
    if (!session || !info || session.status === 'closed' || !owns(info)) {
        return true;
    }
    if (isLiveExternalPlayerSession(session) && !session.canClose) {
        return false;
    }
    try {
        await externalPlayback.closeSession(session);
        return true;
    } catch (error) {
        warn(
            'Closing the previous external player failed; cancelling the replacement.',
            error
        );
        return false;
    }
}
