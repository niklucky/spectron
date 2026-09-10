import type { AgentIdentity } from "@spectron/shared";
export type ModelLimits = { context: number; output: number };
// Provider specifications checked 2026-09-10; sources and conservative fallback
// are documented in the Stage 3 notes. Output is an execution cap, not the
// provider's advertised maximum, to retain the existing per-request budget.
const contexts: Record<string, number> = {
  "openai/gpt-6-astra": 1_050_000,
  "openai/gpt-5.6-sol": 1_050_000,
  "openai/gpt-5.6-terra": 1_050_000,
  "openai/gpt-5.6-luna": 1_050_000,
  "openai/gpt-5.4": 1_050_000,
  "anthropic/claude-opus-5": 1_000_000,
  "anthropic/claude-sonnet-5": 1_000_000,
  "anthropic/claude-haiku-4-5-20251001": 200_000,
  "deepseek/deepseek-v4-pro": 1_000_000,
  "deepseek/deepseek-v4-flash": 1_000_000,
  "zai/glm-5.3": 1_000_000,
};
export function modelLimits(
  agent: Pick<AgentIdentity, "provider" | "model">,
): ModelLimits {
  const key = `${agent.provider}/${agent.model}`;
  let configured: unknown;
  try {
    configured = JSON.parse(process.env.AGENT_MODEL_LIMITS_JSON || "{}")[key];
  } catch {
    throw new Error(
      "AGENT_MODEL_LIMITS_JSON must be a JSON object of provider/model limits.",
    );
  }
  if (configured !== undefined) return validateLimits(configured);
  return contexts[key]
    ? { context: contexts[key]!, output: 16384 }
    : { context: 64000, output: 8192 };
}
export function validateLimits(value: unknown): ModelLimits {
  const limits = value as ModelLimits | null;
  if (
    !limits ||
    !Number.isSafeInteger(limits.context) ||
    !Number.isSafeInteger(limits.output) ||
    limits.output < 1024 ||
    limits.context < limits.output + 8192 ||
    limits.context > 32_000_000
  )
    throw new Error(
      "Model limits require integer context/output tokens and at least 8192 tokens of input capacity.",
    );
  return { context: limits.context, output: limits.output };
}
export function promptByteBudget(limits: ModelLimits) {
  // One UTF-8 byte per token is a conservative text bound. Reserve half the
  // remaining window for tool schemas, images, repository reads and session state.
  return Math.min(2_000_000, Math.floor((limits.context - limits.output) / 2));
}
