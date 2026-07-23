import type { PersistedRecordingItem } from '@iptvnator/shared/interfaces';
import type { RecordingRepository } from './recording-repository';
import { playbackSecretsCleared } from './recording-scheduler.utils';

export async function recoverPersistedRecordings(
    repository: RecordingRepository,
    armRecording: (recording: PersistedRecordingItem) => Promise<void>,
    notify: () => void,
    nowIso: () => string
): Promise<void> {
    const pending = await repository.list(['scheduled', 'recording']);
    for (const recording of pending) {
        try {
            if (recording.status === 'recording') {
                await repository.update(recording.id, {
                    status: 'interrupted',
                    completedAt: nowIso(),
                    errorMessage:
                        'Recording interrupted by application restart',
                    ...playbackSecretsCleared(),
                });
                continue;
            }
            await armRecording(recording);
        } catch {
            // One corrupt/unwritable row must not prevent later schedules.
        }
    }
    if (pending.length > 0) notify();
}
