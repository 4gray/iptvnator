const element = (id) => document.getElementById(id);
const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
let canSeek = false;
let scrubbing = false;
window.floatingPlayer.onState((state) => {
    canSeek = state.canSeek;
    element('pause').textContent = state.paused ? '▶' : 'Ⅱ';
    element('pause').setAttribute(
        'aria-label',
        state.paused ? 'Play' : 'Pause'
    );
    element('pause').title = state.paused ? 'Play' : 'Pause';
    element('volume').value = Math.round(state.volume * 100);
    for (const id of ['back', 'forward', 'timeline'])
        element(id).hidden = !canSeek;
    element('timeline').min = state.seekStart;
    element('timeline').max = state.seekEnd || 1;
    if (!scrubbing) element('timeline').value = state.position;
    element('back').disabled = state.position <= state.seekStart;
    element('forward').disabled = state.position >= state.seekEnd - 0.1;
    element('time').textContent = state.isLive
        ? canSeek
            ? `LIVE · buffered ${formatTime(state.position - state.seekStart)} / ${formatTime(state.seekEnd - state.seekStart)}`
            : 'LIVE'
        : `${formatTime(state.position)} / ${formatTime(state.seekEnd)}`;
});
element('pause').onclick = () => window.floatingPlayer.pause();
element('restore').onclick = element('close').onclick = () =>
    window.floatingPlayer.restore();
element('minimize').onclick = () => window.floatingPlayer.minimize();
element('back').onclick = () => window.floatingPlayer.seekBy(-10);
element('forward').onclick = () => window.floatingPlayer.seekBy(10);
element('volume').oninput = (event) =>
    window.floatingPlayer.volume(Number(event.target.value) / 100);
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
document.addEventListener('focusin', () =>
    window.floatingPlayer.controlsFocus(true)
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
