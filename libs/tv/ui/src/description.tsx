import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { TvDialog } from './dialog';

export function TvDescription({ text }: { text: string }) {
    const preview = useRef<HTMLParagraphElement>(null);
    const [long, setLong] = useState(false);
    const [open, setOpen] = useState(false);
    useLayoutEffect(() => {
        const measure = () => {
            const element = preview.current!;
            setLong(element.scrollHeight > element.clientHeight + 1);
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [text]);
    return (
        <>
            <p ref={preview} class="tv-description-preview">
                {text}
            </p>
            {long ? (
                <button
                    type="button"
                    class="tv-description-more"
                    data-focus="detail-description"
                    onClick={() => setOpen(true)}
                >
                    Read full description
                </button>
            ) : null}
            {open ? (
                <TvDialog title="Full description" close={() => setOpen(false)}>
                    <div
                        class="tv-description-text"
                        tabIndex={0}
                        data-tv-scroll
                        data-dialog-initial
                        aria-label="Description"
                        onKeyDown={(event) => {
                            const direction =
                                event.key === 'ArrowDown' ||
                                event.keyCode === 40
                                    ? 1
                                    : event.key === 'ArrowUp' ||
                                        event.keyCode === 38
                                      ? -1
                                      : 0;
                            if (!direction) return;
                            const pane = event.currentTarget;
                            const before = pane.scrollTop;
                            pane.scrollTop += direction * 120;
                            if (pane.scrollTop !== before) {
                                event.preventDefault();
                                event.stopPropagation();
                            }
                        }}
                    >
                        {text}
                    </div>
                </TvDialog>
            ) : null}
        </>
    );
}
