type AudioBridge = Pick<Window['electron'], 'setEmbeddedMpvVolume'>;

/** Frame-copy volume IPC resolves only after the helper applies the command. */
export async function handoffMpvAudio(
    bridge: AudioBridge,
    outgoing: string,
    incoming: string,
    volume: number,
    canContinue: () => boolean
): Promise<void> {
    if (!canContinue()) throw new Error('Audio handoff cancelled');
    await bridge.setEmbeddedMpvVolume(outgoing, 0);
    if (!canContinue()) throw new Error('Audio handoff cancelled');
    await bridge.setEmbeddedMpvVolume(incoming, volume);
}
