window.floatingPlayer.onState((state) => {
    document.getElementById('pause').textContent = state.paused
        ? 'Play'
        : 'Pause';
    document.getElementById('volume').value = Math.round(state.volume * 100);
});
document
    .getElementById('pause')
    .addEventListener('click', () => window.floatingPlayer.pause());
document
    .getElementById('restore')
    .addEventListener('click', () => window.floatingPlayer.restore());
document
    .getElementById('volume')
    .addEventListener('input', (event) =>
        window.floatingPlayer.volume(Number(event.target.value) / 100)
    );
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.floatingPlayer.restore();
    if (
        event.code === 'Space' &&
        event.target.tagName !== 'INPUT' &&
        event.target.tagName !== 'BUTTON'
    ) {
        event.preventDefault();
        window.floatingPlayer.pause();
    }
});
