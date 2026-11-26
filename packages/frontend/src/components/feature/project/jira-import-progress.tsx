import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { JiraImportProgress } from "@spectron/shared";
import { Icon, type IconName } from "../../ui/icon";

const states = {
  queued:   { text: "Queued",    icon: "clock",        color: "var(--sp-ink-2)" },
  running:  { text: "Importing", icon: "refresh",      color: "var(--sp-accent-ink)" },
  stopping: { text: "Stopping",  icon: "pause",        color: "var(--sp-warn)" },
  stopped:  { text: "Stopped",   icon: "stop",         color: "var(--sp-ink-2)" },
  failed:   { text: "Failed",    icon: "alert",        color: "var(--sp-bad)" },
  finished: { text: "Complete",  icon: "check-circle", color: "var(--sp-ok)" },
} satisfies Record<JiraImportProgress["status"] | "stopping", { text: string; icon: IconName; color: string }>;

export function JiraImportProgressPopover({ progress, stopping = false }: {
  progress: JiraImportProgress;
  stopping?: boolean | undefined;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const processed = progress.imported + progress.failed;
  const total = progress.total;
  const estimated = progress.totalIsEstimate === true;
  const usableTotal = total !== undefined && total >= processed && (total > 0 || !estimated);
  const percent = usableTotal
    ? (total === 0 ? 100 : Math.min(estimated ? 99 : 100, Math.floor(processed / total * 100)))
    : undefined;

  const active = progress.status === "running" || progress.status === "queued";
  const state = states[active && stopping ? "stopping" : progress.status];
  const iconMotion = state === states.running ? "motion-safe:animate-spin-slow" : "";
  const percentText = percent === undefined ? null : `${estimated ? "≈" : ""}${percent}%`;
  const processedText = usableTotal
    ? `${processed.toLocaleString()} of ${estimated ? "about " : ""}${total.toLocaleString()} issues processed`
    : `${processed.toLocaleString()} issues processed`;
  const theme = { "--import-tone": state.color } as CSSProperties;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const { width, height } = panel.current.getBoundingClientRect();
      const below = anchor.bottom + 6;
      setPosition({
        left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)),
        top: below + height + 8 <= window.innerHeight ? below : Math.max(8, anchor.top - height - 6),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" popoverTarget={id} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Show Jira import progress. ${state.text}. ${percentText ?? processedText}`}
      className="jira-import-indicator" style={theme}>
      {state === states.running && percent !== undefined && percent > 0 && percent < 100 ? (
        <span aria-hidden="true" className={`jira-import-ring ${iconMotion}`} style={{ backgroundImage: `conic-gradient(currentColor ${percent}%, transparent 0)` }} />
      ) : <Icon name={state.icon} size={15} className={`shrink-0 ${iconMotion}`} />}
      <span className="truncate">{state.text}</span>
      {percentText && <span className="jira-import-indicator-value">{percentText}</span>}
      <Icon name="chevron" size={12} className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
    </button>

    <div ref={panel} popover="auto" id={id} role="dialog" aria-label="Jira import progress"
      onToggle={event => setOpen(event.newState === "open")}
      style={{ ...position, ...theme }} className="jira-import-panel">
      <header className="flex items-center gap-3 px-5 pt-5">
        <img src="/assets/integrations/jira.svg" alt="" width={36} height={36} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-ink-2">Jira Cloud</div>
          <h3 className="m-0 text-lg font-semibold leading-tight tracking-tight">{progress.kind === "full" ? "Full import" : "Scheduled import"}</h3>
        </div>
        <button type="button" aria-label="Close import progress" popoverTarget={id} popoverTargetAction="hide"
          className="grid size-8 shrink-0 place-items-center self-start rounded-lg text-ink-2 hover:bg-surface-3 focus-visible:outline-accent">
          <Icon name="close" size={15} />
        </button>
      </header>

      <div className="px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="jira-import-number">
            {percent !== undefined ? <>
              {estimated && <span className="mr-0.5 text-[.62em] text-ink-2">≈</span>}
              {percent}<span className="ml-0.5 text-[.64em] text-ink-2">%</span>
            </> : processed.toLocaleString()}
          </div>
          <span className="jira-import-state"><Icon name={state.icon} size={13} className={iconMotion} />{state.text}</span>
        </div>
        <div role="progressbar" aria-label="Issues processed" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={percent} aria-valuetext={processedText} className="jira-import-track">
          {percent !== undefined
            ? <span className="jira-import-fill" style={{ width: `${percent}%` }} />
            : active && <span className="jira-import-fill w-1/3 motion-safe:animate-slide" />}
        </div>
        <div className="mt-2 text-xs tabular-nums text-ink-2">{processedText}{!usableTotal && progress.status !== "queued" && " · Total unavailable"}</div>
      </div>

      <dl className="mx-5 mb-4 mt-0 grid grid-cols-2 rounded-lg bg-surface-2 py-3">
        <div className="px-3.5">
          <dt className="flex items-center gap-1.5 text-xs text-ink-2"><Icon name="check-circle" size={14} className="text-ok" />Imported</dt>
          <dd className="m-0 mt-1 text-xl font-semibold leading-none tabular-nums">{progress.imported.toLocaleString()}</dd>
        </div>
        <div className="border-0 border-l border-solid border-line px-3.5">
          <dt className="flex items-center gap-1.5 text-xs text-ink-2"><Icon name="alert" size={14} className={progress.failed ? "text-bad" : "text-ink-3"} />Failed</dt>
          <dd className={`m-0 mt-1 text-xl font-semibold leading-none tabular-nums ${progress.failed ? "text-bad" : "text-ink-2"}`}>{progress.failed.toLocaleString()}</dd>
        </div>
      </dl>

      {progress.currentKey && <div className="flex items-center justify-between gap-3 px-5 py-3 hairline-t">
        <span className="shrink-0 text-xs text-ink-2">Current issue</span>
        <span className="truncate rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-medium" title={progress.currentKey}>{progress.currentKey}</span>
      </div>}
      {progress.message && !active && <p className="m-0 break-words px-5 py-3 text-sm text-ink-2 hairline-t">{progress.message}</p>}
    </div>
  </>;
}
