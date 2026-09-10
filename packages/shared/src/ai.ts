export const aiProviders = ["openai", "zai", "deepseek", "anthropic"] as const;
export type AIProvider = (typeof aiProviders)[number];
export const aiEfforts = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type AIEffort = (typeof aiEfforts)[number];
export type AIModel = {
  id: string;
  name: string;
  efforts: AIEffort[];
  defaultEffort: AIEffort | null;
};
export type AIProviderDefinition = {
  id: AIProvider;
  name: string;
  models: AIModel[];
  checkUsesTokens: boolean;
};

// Curated provider API capabilities, checked 2026-09-10. Sources and runtime
// compatibility limits are recorded in docs/ai-agents-stage-1.md.
// These are provider model IDs, not OpenCode provider/model identifiers.
export const aiCatalog: AIProviderDefinition[] = [
  {
    id: "openai",
    name: "OpenAI",
    checkUsesTokens: false,
    models: [
      {
        id: "gpt-6-astra",
        name: "GPT-6 Astra",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
      },
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        efforts: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
      },
      {
        id: "gpt-5.6-terra",
        name: "GPT-5.6 Terra",
        efforts: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
      },
      {
        id: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        efforts: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        efforts: ["none", "low", "medium", "high", "xhigh"],
        defaultEffort: "none",
      },
    ],
  },
  {
    id: "zai",
    name: "Z.ai",
    checkUsesTokens: true,
    models: [
      {
        id: "glm-5.3",
        name: "GLM-5.3",
        efforts: ["low", "high", "max"],
        defaultEffort: "max",
      },
      {
        id: "glm-5.3-flash",
        name: "GLM-5.3-flash",
        efforts: ["low", "high", "max"],
        defaultEffort: "max",
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    checkUsesTokens: false,
    models: [
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 pro",
        efforts: ["none", "low", "high", "max"],
        defaultEffort: "high",
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 flash",
        efforts: ["none", "low", "high", "max"],
        defaultEffort: "high",
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    checkUsesTokens: false,
    models: [
      {
        id: "claude-opus-5",
        name: "Claude Opus 5",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "high",
      },
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "high",
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        efforts: [],
        defaultEffort: null,
      },
    ],
  },
];

export type AIConnectionSummary = {
  id: string;
  ownerId: string;
  name: string;
  provider: AIProvider;
  revision: number;
  keyUpdatedAt: string;
  checkedAt: string | null;
  checkStatus: "untested" | "passed" | "failed";
  createdAt: string;
  updatedAt: string;
};
export type AIConnectionInput = {
  name: string;
  provider: AIProvider;
  apiKey: string;
};
export type AgentIdentity = {
  kind: "agent";
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  avatar: string | null;
  role: string;
  provider: AIProvider;
  model: string;
  effort: AIEffort | null;
};
export type AgentInput = {
  name: string;
  avatar: string | null;
  connectionId: string;
  model: string;
  effort: AIEffort | null;
  role: string;
  instructions: string;
};
export type AgentSummary = AgentIdentity &
  AgentInput & {
    revision: number;
    createdAt: string;
    updatedAt: string;
  };
export type AgentSharing = {
  projectId: string;
  visibility: "selected" | "project";
  memberIds: string[];
};
