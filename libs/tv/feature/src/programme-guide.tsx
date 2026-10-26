import {
    GuideProgram,
    guidePrograms,
    Media,
    Program,
    programmeNow,
    programmeWindow,
} from '@iptvnator/tv/util';
import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'preact/hooks';

const time = (value: number) =>
    new Date(value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
const date = (value: number) =>
    new Date(value).toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });

export function ProgrammeGuide({
    programs,
    channel,
    enabled,
    error,
    close,
}: {
    programs: Program[];
    channel: Media | undefined;
    enabled: boolean;
    error: string;
    close: () => void;
}) {
    const rows = useMemo(() => guidePrograms(programs), [programs]);
    return (
        <div class="programme-guide">
            <header class="programme-guide-header">
                <div>
                    <span class="muted">Programme guide</span>
                    <h1>{channel?.title ?? 'Live TV'}</h1>
                </div>
                <button data-focus="guide-close" onClick={close}>
                    Close programme ×
                </button>
            </header>
            {!enabled || !rows.length ? (
                <p role="status" class="muted">
                    {!enabled
                        ? 'Programme guide is disabled in Settings.'
                        : error || 'No programme information supplied.'}
                </p>
            ) : (
                <ProgrammeSchedule key={channel?.id ?? ''} rows={rows} />
            )}
        </div>
    );
}

function ProgrammeSchedule({ rows }: { rows: GuideProgram[] }) {
    const [now, setNow] = useState(Date.now);
    const [selection, setSelection] = useState(
        () => (programmeNow(rows, now) ?? rows[0]).id
    );
    const selected =
        rows.find((row) => row.id === selection) ??
        programmeNow(rows, now) ??
        rows[0];
    const days = useMemo(
        () =>
            rows.filter(
                (row, index) => !index || row.day !== rows[index - 1].day
            ),
        [rows]
    );
    const dayRows = rows.filter((row) => row.day === selected.day);
    const dayIndex = days.findIndex((row) => row.day === selected.day);
    const dayStart = Math.max(0, Math.min(dayIndex - 3, days.length - 7));
    const index = dayRows.findIndex((row) => row.id === selected.id);
    const [scroll, setScroll] = useState(Math.max(0, index - 1) * 100);
    const list = useRef<HTMLDivElement>(null);
    const details = useRef<HTMLDivElement>(null);
    const pendingFocus = useRef(false);
    const day = useRef(selected.day);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);
    useLayoutEffect(() => {
        if (list.current) list.current.scrollTop = scroll;
    }, []);
    useLayoutEffect(() => {
        if (details.current) details.current.scrollTop = 0;
        if (day.current !== selected.day && list.current) {
            day.current = selected.day;
            list.current.scrollTop = Math.max(0, index - 1) * 100;
            setScroll(list.current.scrollTop);
        }
        if (pendingFocus.current) {
            const row = list.current?.querySelector<HTMLButtonElement>(
                `[data-programme-index="${index}"]`
            );
            row?.focus({ preventScroll: true });
            row?.scrollIntoView({ block: 'nearest' });
            pendingFocus.current = false;
        }
    }, [selected.id]);
    const choose = (row: GuideProgram, focus = false) => {
        pendingFocus.current = focus;
        setSelection(row.id);
        if (row.id === selected.id && focus) {
            const button = list.current?.querySelector<HTMLButtonElement>(
                `[data-programme-index="${index}"]`
            );
            button?.focus();
            button?.scrollIntoView({ block: 'nearest' });
            pendingFocus.current = false;
        }
    };
    const current = selected.start <= now && selected.end > now;
    return (
        <>
            <div class="programme-guide-days" aria-label="Programme dates">
                <button
                    data-focus="guide-now"
                    onClick={() => {
                        setNow(Date.now());
                        choose(programmeNow(rows, Date.now()) ?? rows[0], true);
                    }}
                >
                    Now
                </button>
                {dayStart > 0 ? (
                    <button
                        aria-label="Earlier dates"
                        onClick={() => choose(days[dayStart - 1])}
                    >
                        ‹
                    </button>
                ) : null}
                {days.slice(dayStart, dayStart + 7).map((row) => (
                    <button
                        key={row.day}
                        data-focus={`guide-day-${row.day}`}
                        aria-pressed={row.day === selected.day}
                        onClick={() => choose(row)}
                    >
                        {date(row.start)}
                    </button>
                ))}
                {dayStart + 7 < days.length ? (
                    <button
                        aria-label="Later dates"
                        onClick={() => choose(days[dayStart + 7])}
                    >
                        ›
                    </button>
                ) : null}
            </div>
            <div class="programme-guide-body">
                <div
                    class="programme-guide-schedule"
                    ref={list}
                    role="region"
                    aria-label="Programmes"
                    onScroll={(event) =>
                        setScroll(event.currentTarget.scrollTop)
                    }
                    onKeyDown={(event) => {
                        if (
                            event.key === 'ArrowRight' ||
                            event.keyCode === 39
                        ) {
                            event.preventDefault();
                            event.stopPropagation();
                            details.current?.focus();
                            return;
                        }
                        const down =
                            event.key === 'ArrowDown' || event.keyCode === 40;
                        const up =
                            event.key === 'ArrowUp' || event.keyCode === 38;
                        if (down || up) {
                            event.preventDefault();
                            event.stopPropagation();
                            const next = index + (down ? 1 : -1);
                            if (next >= 0 && next < dayRows.length)
                                choose(dayRows[next], true);
                            else if (up)
                                document
                                    .querySelector<HTMLButtonElement>(
                                        '[data-focus="guide-now"]'
                                    )
                                    ?.focus();
                        }
                    }}
                >
                    <div
                        class="programme-guide-window"
                        style={{ height: dayRows.length * 100 }}
                    >
                        {programmeWindow(dayRows.length, scroll, index).map(
                            (position) => {
                                const row = dayRows[position];
                                return (
                                    <button
                                        key={row.id}
                                        class="programme-guide-row"
                                        style={{ top: position * 100 }}
                                        data-programme-index={position}
                                        data-focus={`guide-programme-${row.start}-${position}`}
                                        aria-pressed={row.id === selected.id}
                                        onFocus={() => choose(row)}
                                        onClick={() => choose(row)}
                                    >
                                        <time>
                                            {time(row.start)} – {time(row.end)}
                                        </time>
                                        <strong>{row.title}</strong>
                                        {row.start <= now && row.end > now ? (
                                            <small>Now playing</small>
                                        ) : null}
                                    </button>
                                );
                            }
                        )}
                    </div>
                </div>
                <div
                    class="programme-guide-details"
                    ref={details}
                    tabIndex={0}
                    data-tv-scroll
                    data-focus="guide-description"
                    role="region"
                    aria-label="Programme description"
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft' || event.keyCode === 37) {
                            event.preventDefault();
                            event.stopPropagation();
                            choose(selected, true);
                            return;
                        }
                        const down =
                            event.key === 'ArrowDown' || event.keyCode === 40;
                        const up =
                            event.key === 'ArrowUp' || event.keyCode === 38;
                        if (down || (up && event.currentTarget.scrollTop > 0)) {
                            event.preventDefault();
                            event.stopPropagation();
                            event.currentTarget.scrollTop += down ? 120 : -120;
                        }
                    }}
                >
                    <span class="programme-guide-state">
                        {current ? 'Now playing' : date(selected.start)}
                    </span>
                    <h2>{selected.title}</h2>
                    <p class="muted">
                        {time(selected.start)} – {time(selected.end)}
                    </p>
                    <p>{selected.description || 'No description supplied.'}</p>
                </div>
            </div>
        </>
    );
}
