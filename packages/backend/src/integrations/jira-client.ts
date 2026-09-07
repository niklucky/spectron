// Adapted from spectron-prototype Jira Cloud client.
const DEFAULT_PAGE_SIZE = 50;
const JIRA_SEARCH_PATH = "/rest/api/3/search/jql";

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraStatusRef {
  id: string;
  name: string;
}

export interface JiraPriorityRef {
  id: string;
  name: string;
}

export interface JiraIssueTypeRef {
  id: string;
  name: string;
}

export interface JiraComment {
  id: string;
  body?: unknown;
  author?: JiraUser;
  created?: string;
  updated?: string;
}

export interface JiraWorklog {
  id: string;
  author?: JiraUser;
  started: string;
  timeSpentSeconds?: number;
  comment?: unknown;
  created?: string;
  updated?: string;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
  content?: string;
  thumbnail?: string;
  author?: JiraUser;
  created?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: JiraStatusRef | null;
    priority?: JiraPriorityRef | null;
    issuetype?: JiraIssueTypeRef | null;
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    comment?: {
      comments: JiraComment[];
      total: number;
      maxResults: number;
      startAt: number;
    };
    worklog?: {
      worklogs: JiraWorklog[];
      total: number;
      maxResults: number;
      startAt: number;
    };
    attachment?: JiraAttachment[];
    created?: string;
    updated?: string;
    duedate?: string | null;
    timeoriginalestimate?: number | null;
    timespent?: number | null;
    timetracking?: {
      originalEstimate?: string;
      originalEstimateSeconds?: number;
      timeSpent?: string;
      timeSpentSeconds?: number;
    } | null;
    [key: string]: unknown;
  };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraField {
  id: string;
  key?: string;
  name: string;
  schema?: { type?: string; custom?: string };
}

export interface JiraTransition {
  id: string;
  name: string;
  to?: JiraStatusRef;
}

export interface JiraProjectStatusGroup {
  id: string;
  name: string;
  statuses: JiraStatusRef[];
}

export class JiraApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
    public readonly path: string,
  ) {
    super(
      `Jira request failed (${status}). Check credentials, permissions, mappings and required Jira fields.`,
    );
  }
}

export class JiraClient {
  private readonly baseUrl: string;

  constructor(
    rawBaseUrl: string,
    private readonly email: string,
    private readonly apiToken: string,
    private readonly cancellation?: {
      signal: AbortSignal;
      check: () => Promise<void>;
    },
  ) {
    const url = new URL(rawBaseUrl);
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "Use a Jira Cloud site URL such as https://team.atlassian.net.",
      );
    this.baseUrl = url.origin;
  }

  async checkpoint() {
    this.cancellation?.signal.throwIfAborted();
    await this.cancellation?.check();
  }
  private signal(timeout: number) {
    return this.cancellation
      ? AbortSignal.any([
          this.cancellation.signal,
          AbortSignal.timeout(timeout),
        ])
      : AbortSignal.timeout(timeout);
  }
  private headers(): Record<string, string> {
    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString(
      "base64",
    );
    return {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    await this.checkpoint();
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: this.headers(),
      redirect: "error",
      signal: this.signal(30_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new JiraApiError(response.status, text, path);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async testConnection(
    projectKey: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await this.getProject(projectKey);
      return { success: true, message: "Connection successful" };
    } catch (error: any) {
      if (error instanceof JiraApiError) {
        if (error.status === 401)
          return { success: false, message: "Invalid Jira credentials" };
        if (error.status === 403)
          return { success: false, message: "Access denied to Jira project" };
        if (error.status === 404)
          return { success: false, message: "Jira project not found" };
      }
      return { success: false, message: error.message ?? "Connection failed" };
    }
  }

  async getProject(projectKey: string): Promise<JiraProject> {
    return this.request<JiraProject>(
      "GET",
      `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
    );
  }

  async getProjects(): Promise<JiraProject[]> {
    return this.request<JiraProject[]>(
      "GET",
      "/rest/api/3/project/search",
    ).then((result: any) => result.values ?? result ?? []);
  }

  async getIssueCount(jql: string): Promise<number> {
    const result = await this.request<{ count: number }>(
      "POST",
      "/rest/api/3/search/approximate-count",
      {
        jql,
      },
    );
    return Number(result.count ?? 0);
  }

  async searchIssues(options: {
    projectKey: string;
    updatedAfter?: Date;
    nextPageToken?: string;
    maxResults?: number;
  }): Promise<{
    issues: JiraIssue[];
    isLast: boolean;
    nextPageToken?: string;
    maxResults: number;
  }> {
    const maxResults = options.maxResults ?? DEFAULT_PAGE_SIZE;
    let jql = `project = ${quoteJqlValue(options.projectKey)}`;
    if (options.updatedAfter) {
      // Unquoted epoch milliseconds avoid the connected Jira user's time zone.
      const timestamp = options.updatedAfter.getTime();
      if (!Number.isFinite(timestamp))
        throw new Error("Invalid Jira search date.");
      jql += ` AND updated >= ${timestamp}`;
    }
    jql += " ORDER BY updated ASC";

    return this.request<{
      issues: JiraIssue[];
      isLast: boolean;
      nextPageToken?: string;
      maxResults: number;
    }>("POST", JIRA_SEARCH_PATH, {
      jql,
      maxResults,
      ...(options.nextPageToken
        ? { nextPageToken: options.nextPageToken }
        : {}),
      fields: ["*all"],
    });
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      undefined,
      {
        fields: "*all",
      },
    );
  }

  async getComments(issueKey: string): Promise<JiraComment[]> {
    let startAt = 0;
    const comments: JiraComment[] = [];

    while (true) {
      const page = await this.request<{
        comments: JiraComment[];
        total: number;
        startAt: number;
        maxResults: number;
      }>(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
        undefined,
        { startAt, maxResults: DEFAULT_PAGE_SIZE },
      );
      comments.push(...(page.comments ?? []));
      if (
        !page.maxResults ||
        (!page.comments?.length && comments.length < page.total)
      )
        throw new Error("Jira comment pagination stalled.");
      startAt += page.maxResults;
      if (comments.length >= (page.total ?? 0)) break;
    }

    return comments;
  }

  async getWorklogs(issueKey: string): Promise<JiraWorklog[]> {
    let startAt = 0;
    const worklogs: JiraWorklog[] = [];

    while (true) {
      const page = await this.request<{
        worklogs: JiraWorklog[];
        total: number;
        startAt: number;
        maxResults: number;
      }>(
        "GET",
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`,
        undefined,
        { startAt, maxResults: DEFAULT_PAGE_SIZE },
      );
      worklogs.push(...(page.worklogs ?? []));
      if (
        !page.maxResults ||
        (!page.worklogs?.length && worklogs.length < page.total)
      )
        throw new Error("Jira worklog pagination stalled.");
      startAt += page.maxResults;
      if (worklogs.length >= (page.total ?? 0)) break;
    }

    return worklogs;
  }

  async getProjectStatuses(
    projectKey: string,
  ): Promise<JiraProjectStatusGroup[]> {
    return this.request<JiraProjectStatusGroup[]>(
      "GET",
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`,
    );
  }

  async getIssueTypes(projectKey: string): Promise<JiraIssueTypeRef[]> {
    const groups = await this.getProjectStatuses(projectKey);
    return groups.map((group) => ({ id: group.id, name: group.name }));
  }

  async getPriorities(): Promise<JiraPriorityRef[]> {
    return this.request<JiraPriorityRef[]>("GET", "/rest/api/3/priority");
  }

  async getFields(): Promise<JiraField[]> {
    return this.request<JiraField[]>("GET", "/rest/api/3/field");
  }

  async getAssignableUsers(
    projectKey: string,
    query = "",
  ): Promise<JiraUser[]> {
    return this.request<JiraUser[]>(
      "GET",
      "/rest/api/3/user/assignable/search",
      undefined,
      { project: projectKey, query, maxResults: 1000 },
    );
  }

  async updateIssue(
    issueKey: string,
    payload: {
      fields?: Record<string, unknown>;
      update?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.request<void>(
      "PUT",
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      payload,
    );
  }

  async createIssue(
    fields: Record<string, unknown>,
  ): Promise<{ id: string; key: string }> {
    return this.request<{ id: string; key: string }>(
      "POST",
      "/rest/api/3/issue",
      { fields },
    );
  }

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const result = await this.request<{ transitions: JiraTransition[] }>(
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    );
    return result.transitions ?? [];
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request<void>(
      "POST",
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
      { transition: { id: transitionId } },
    );
  }

  async addWorklog(
    issueKey: string,
    entry: { start: Date; durationMinutes: number; comment?: string },
  ): Promise<JiraWorklog> {
    return this.request<JiraWorklog>(
      "POST",
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`,
      {
        started: formatJiraDate(entry.start),
        timeSpentSeconds: entry.durationMinutes * 60,
        ...(entry.comment ? { comment: textToAdf(entry.comment) } : {}),
      },
    );
  }

  async downloadAttachment(
    attachment: Pick<JiraAttachment, "id">,
  ): Promise<ReadableStream<Uint8Array>> {
    await this.checkpoint();
    // Never trust arbitrary content URLs or forward credentials to media hosts.
    const response = await fetch(
      `${this.baseUrl}/rest/api/3/attachment/content/${encodeURIComponent(attachment.id)}?redirect=false`,
      {
        headers: this.headers(),
        redirect: "error",
        signal: this.signal(60_000),
      },
    );
    if (!response.ok || !response.body)
      throw new JiraApiError(response.status, "", "attachment");
    return response.body;
  }
  async saveComment(
    issueId: string,
    body: unknown,
    commentId?: string,
  ): Promise<JiraComment> {
    return this.request<JiraComment>(
      commentId ? "PUT" : "POST",
      `/rest/api/3/issue/${encodeURIComponent(issueId)}/comment${commentId ? `/${encodeURIComponent(commentId)}` : ""}`,
      { body },
    );
  }
}

export function adfToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const node = value as { type?: string; text?: string; content?: unknown[] };
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";

  if (Array.isArray(node.content)) {
    return node.content
      .map(adfToText)
      .join(
        node.type === "doc" ||
          node.type === "bulletList" ||
          node.type === "orderedList"
          ? "\n"
          : "",
      );
  }

  return "";
}

export function textToAdf(text: string): Record<string, unknown> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: "paragraph",
      content: paragraph.split("\n").flatMap((line, index, arr) => {
        const parts: Array<Record<string, unknown>> = [
          { type: "text", text: line },
        ];
        if (index < arr.length - 1) {
          parts.push({ type: "hardBreak" });
        }
        return parts;
      }),
    }));

  return {
    type: "doc",
    version: 1,
    content:
      paragraphs.length > 0 ? paragraphs : [{ type: "paragraph", content: [] }],
  };
}

export function minutesToJiraEstimate(minutes: number): string {
  if (minutes <= 0) return "0m";
  if (minutes % (8 * 60) === 0) return `${minutes / (8 * 60)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function formatJiraDate(value: Date): string {
  return value.toISOString().replace("Z", "+0000");
}

function quoteJqlValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
