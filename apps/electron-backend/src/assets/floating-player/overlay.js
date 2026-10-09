const element = (id) => document.getElementById(id);
const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
let canSeek = false;
let scrubbing = false;
let lastAudibleVolume = 1;
let currentVolume = 1;
const paintRange = (input) => {
    const span = Number(input.max) - Number(input.min);
    const percent =
        span > 0 ? (100 * (Number(input.value) - Number(input.min))) / span : 0;
    input.style.setProperty(
        '--progress',
        `${Math.max(0, Math.min(100, percent))}%`
    );
};
window.floatingPlayer.onState((state) => {
    canSeek = state.canSeek;
    element('play-icon').hidden = !state.paused;
    element('pause-icon').hidden = state.paused;
    element('pause').setAttribute(
        'aria-label',
        state.paused ? 'Play' : 'Pause'
    );
    element('pause').title = state.paused ? 'Play' : 'Pause';
    element('volume').value = Math.round(state.volume * 100);
    currentVolume = state.volume;
    if (currentVolume > 0) lastAudibleVolume = currentVolume;
    element('speaker-waves').hidden = currentVolume === 0;
    element('speaker-muted').hidden = currentVolume !== 0;
    element('mute').title = currentVolume === 0 ? 'Unmute' : 'Mute';
    element('mute').setAttribute('aria-label', element('mute').title);
    for (const id of ['back', 'forward', 'timeline'])
        element(id).hidden = !canSeek;
    element('timeline').min = state.seekStart;
    element('timeline').max = state.seekEnd || 1;
    if (!scrubbing) element('timeline').value = state.position;
    paintRange(element('timeline'));
    paintRange(element('volume'));
    element('back').disabled = state.position <= state.seekStart;
    element('forward').disabled = state.position >= state.seekEnd - 0.1;
    element('time').textContent = state.isLive
        ? canSeek
            ? state.seekEnd - state.position <= 2
                ? 'LIVE'
                : `LIVE · −${formatTime(state.seekEnd - state.position)}`
            : 'LIVE'
        : `${formatTime(state.position)} / ${formatTime(state.seekEnd)}`;
    element('time').title =
        state.isLive && canSeek
            ? 'Time behind the latest seekable buffered position'
            : element('time').textContent;
});
element('mute').onclick = () =>
    window.floatingPlayer.volume(currentVolume > 0 ? 0 : lastAudibleVolume);
element('pause').onclick = () => window.floatingPlayer.pause();
element('restore').onclick = element('close').onclick = () =>
    window.floatingPlayer.restore();
element('minimize').onclick = () => window.floatingPlayer.minimize();
element('back').onclick = () => window.floatingPlayer.seekBy(-10);
element('forward').onclick = () => window.floatingPlayer.seekBy(10);
element('volume').oninput = (event) => {
    paintRange(event.target);
    window.floatingPlayer.volume(Number(event.target.value) / 100);
};
element('timeline').oninput = (event) => paintRange(event.target);
element('timeline').onpointerdown = () => {
    scrubbing = true;
};
element('timeline').onchange = (event) => {
    scrubbing = false;
    window.floatingPlayer.seek(Number(event.target.value));
};
element('timeline').onpointercancel = () => {
    scrubbing = false;
};
let keyboardInteraction = false;
let pointerInteraction = false;
document.addEventListener('pointerdown', () => {
    keyboardInteraction = false;
    pointerInteraction = true;
    window.floatingPlayer.controlsFocus(true);
});
const endPointerInteraction = () => {
    scrubbing = false;
    pointerInteraction = false;
    window.floatingPlayer.controlsFocus(keyboardInteraction);
};
document.addEventListener('pointerup', endPointerInteraction);
document.addEventListener('pointercancel', endPointerInteraction);
document.addEventListener('focusin', () =>
    window.floatingPlayer.controlsFocus(
        keyboardInteraction || pointerInteraction
    )
);
document.addEventListener('focusout', () =>
    window.floatingPlayer.controlsFocus(false)
);
const handle = element('drag-handle');
handle.onpointerdown = (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    handle.setPointerCapture(event.pointerId);
    window.floatingPlayer.drag('start');
};
handle.onpointermove = (event) => {
    if (handle.hasPointerCapture(event.pointerId))
        window.floatingPlayer.drag('move');
};
handle.onpointerup = handle.onpointercancel = (event) => {
    if (handle.hasPointerCapture(event.pointerId))
        handle.releasePointerCapture(event.pointerId);
    window.floatingPlayer.drag('end');
};
document.addEventListener('keydown', (event) => {
    keyboardInteraction = true;
    if (document.activeElement?.matches('button, input'))
        window.floatingPlayer.controlsFocus(true);
    if (event.key === 'Escape') window.floatingPlayer.restore();
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON')
        return;
    if (event.code === 'Space') {
        event.preventDefault();
        window.floatingPlayer.pause();
    }
    if (canSeek && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        window.floatingPlayer.seekBy(event.key === 'ArrowLeft' ? -10 : 10);
    }
});
