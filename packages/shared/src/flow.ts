export const flowChangeKinds = ["issue", "activity", "runs", "git", "handoffs"] as const;
export type FlowChangeKind = typeof flowChangeKinds[number];
export type FlowChange = { projectId: string; issueId: string; kind: FlowChangeKind };
export type FlowMessage = { type: "ready" } | { type: "changes"; changes: FlowChange[] };
export type SubscribeToFlow = (listener: (message: FlowMessage) => void) => () => void;
