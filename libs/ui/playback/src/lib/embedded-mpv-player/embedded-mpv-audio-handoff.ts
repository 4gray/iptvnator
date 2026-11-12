type AudioBridge = Pick<Window['electron'], 'setEmbeddedMpvVolume'>;

/** Frame-copy volume IPC resolves only after the helper applies the command. */
export async function handoffMpvAudio(
    bridge: AudioBridge,
    outgoing: string,
    incoming: string,
    volume: number,
    signal: AbortSignal
): Promise<void> {
    if (signal.aborted) throw new Error('Audio handoff cancelled');
    await bridge.setEmbeddedMpvVolume(outgoing, 0);
    if (signal.aborted) throw new Error('Audio handoff cancelled');
    await bridge.setEmbeddedMpvVolume(incoming, volume);
}
