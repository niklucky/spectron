import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import type { FlowChange, FlowMessage, SubscribeToFlow } from "@spectron/shared";

export function useFlowEvents(refreshIssues: () => Promise<void>, refreshProjects: () => Promise<void>) {
  const listeners = useRef(new Set<(message: FlowMessage) => void>());
  const subscribe = useCallback<SubscribeToFlow>(listener => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const refreshProjectList = useEffectEvent(refreshProjects);
  const refresh = useEffectEvent(refreshIssues);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket;
    let retry: number | undefined;
    let delay = 500;
    let refreshing = false;
    let needsSnapshot = false;
    const issues = new Map<string, FlowChange>();
    const deliver = (message: FlowMessage) => {
      for (const listener of listeners.current) listener(message);
    };
    async function updateIssues() {
      if (refreshing) return;
      refreshing = true;
      try {
        while (!stopped && (needsSnapshot || issues.size)) {
          const message: FlowMessage = needsSnapshot ? { type: "ready" } : { type: "changes", changes: [...issues.values()] };
          needsSnapshot = false;
          issues.clear();
          // Deliver the detail invalidation together with the fresh list watermark.
          await refresh();
          if (!stopped) deliver(message);
        }
      } finally {
        refreshing = false;
      }
    }
    function connect() {
      const url = new URL("/api/flow/events", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onmessage = event => {
        const message: FlowMessage = JSON.parse(event.data);
        if (message.type === "ready") {
          delay = 500;
          needsSnapshot = true;
          void refreshProjectList();
        } else {
          const detail = message.changes.filter(change => change.kind !== "issue");
          if (detail.length) deliver({ type: "changes", changes: detail });
          for (const change of message.changes) {
            if (change.kind === "issue") issues.set(change.issueId, change);
          }
        }
        void updateIssues();
      };
      socket.onclose = () => {
        if (stopped) return;
        retry = window.setTimeout(connect, delay + Math.random() * delay / 4);
        delay = Math.min(30000, delay * 2);
      };
    }
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket.onmessage = null;
      socket.close();
    };
  }, []);
  return subscribe;
}
