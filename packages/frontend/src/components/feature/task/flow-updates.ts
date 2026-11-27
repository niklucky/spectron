import { useEffect, useState } from "react";
import type { FlowChangeKind, SubscribeToFlow } from "@spectron/shared";

function subscribeToChanges(subscribe: SubscribeToFlow | undefined, issueId: string, kind: FlowChangeKind, changed: () => void) {
  return subscribe?.(message => {
    if (message.type === "ready" || message.changes.some(c => c.issueId === issueId && c.kind === kind)) changed();
  });
}

export function useFlowRevision(subscribe: SubscribeToFlow | undefined, issueId: string, kind: FlowChangeKind) {
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeToChanges(subscribe, issueId, kind, () => setRevision(value => value + 1)), [subscribe, issueId, kind]);
  return revision;
}

// A busy run can commit more often than a request completes. Show each finished
// snapshot, then fetch once more if changes arrived while it was in flight.
export function watchFlowQuery<T>(
  subscribe: SubscribeToFlow | undefined,
  issueId: string,
  kind: FlowChangeKind,
  load: () => Promise<T>,
  apply: (value: T) => void,
  onError: (cause: unknown) => void,
) {
  let active = true;
  let running = false;
  let dirty = false;
  let timer: number | undefined;
  let nextLoad = 0;
  let retryDelay = 1000;
  function schedule() {
    dirty = true;
    if (!active || running || timer !== undefined) return;
    const delay = Math.max(0, nextLoad - performance.now());
    timer = window.setTimeout(() => { void refresh(); }, delay);
  }
  async function refresh() {
    timer = undefined;
    if (!active) return;
    dirty = false;
    running = true;
    nextLoad = performance.now() + 750;
    try {
      const value = await load();
      if (active) apply(value);
      retryDelay = 1000;
    } catch (cause) {
      if (active) {
        onError(cause);
        dirty = true;
        nextLoad = performance.now() + retryDelay;
        retryDelay = Math.min(30000, retryDelay * 2);
      }
    } finally {
      running = false;
      if (dirty) schedule();
    }
  }
  const unsubscribe = subscribeToChanges(subscribe, issueId, kind, schedule);
  window.addEventListener("focus", schedule);
  void refresh();
  return () => {
    active = false;
    window.clearTimeout(timer);
    unsubscribe?.();
    window.removeEventListener("focus", schedule);
  };
}
