/**
 * Yandex Tracker API v3 client
 * Docs: https://yandex.ru/support/tracker/ru/api-ref/access
 */

const BASE_URL = "https://api.tracker.yandex.net/v3";

export interface YTIssue {
  id: string;
  key: string;
  version: number;
  summary: string;
  description?: string;
  type?: { id: string; key: string; display: string };
  priority?: { id: string; key: string; display: string };
  status?: { id: string; key: string; display: string };
  assignee?: {
    id: string;
    uid: number;
    login: string;
    email?: string;
    display: string;
  };
  createdBy?: {
    id: string;
    uid: number;
    login: string;
    email?: string;
    display: string;
  };
  queue?: { id: string; key: string; display: string };
  tags?: string[];
  components?: Array<{ id: string; display: string }>;
  sprint?: Array<{ id: string; display: string }>;
  estimation?: string; // ISO 8601 duration e.g. "PT8H"
  spent?: string; // ISO 8601 duration
  storyPoints?: number;
  deadline?: string; // ISO 8601 date
  start?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  // custom fields are additional properties
  [key: string]: unknown;
}

export interface YTIssueUpdate {
  summary?: string;
  description?: string;
  type?: { id?: string; key?: string };
  priority?: { id?: string; key?: string } | null;
  assignee?: { id?: string; login?: string } | null;
  tags?: string[];
  estimation?: string; // ISO 8601 duration
  deadline?: string;
  start?: string;
  storyPoints?: number;
  [key: string]: unknown;
}

export interface YTIssueCreate {
  unique?: string;
  [key: string]: unknown;
  queue: string;
  summary: string;
  description?: string;
  type?: { id?: string; key?: string };
  priority?: { id?: string; key?: string };
  assignee?: { id?: string; login?: string };
  tags?: string[];
  estimation?: string;
}

export interface YTTransition {
  id: string;
  display: string;
  to: { id: string; key: string; display: string };
}

export interface YTStatus {
  id: string;
  key: string;
  display: string;
  type?: string;
}

export interface YTField {
  id: string;
  key?: string;
  name: string;
  display: string;
  schema?: { type: string; required?: boolean; readonly?: boolean };
}

export interface YTQueue {
  id: string;
  key: string;
  name: string;
  description?: string;
}

export interface YTWorklog {
  id: string;
  start: string;
  duration: string;
  comment?: string;
  createdBy: {
    id: string;
    uid?: number;
    login?: string;
    email?: string;
    display: string;
  };
  createdAt: string;
}

export interface YTComment {
  id: string;
  text: string;
  createdBy: {
    id: string;
    uid?: number;
    login?: string;
    email?: string;
    display: string;
  };
  updatedBy?: { id: string; display: string };
  createdAt: string;
  updatedAt: string;
}

export interface YTSearchResult {
  issues: YTIssue[];
  total: number;
  page: number;
  perPage: number;
}

export class YandexTrackerClient {
  constructor(
    private readonly token: string,
    private readonly orgId?: string, // Yandex 360 org ID (X-Org-ID)
    private readonly cloudOrgId?: string, // Yandex Cloud org ID (X-Cloud-Org-Id)
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `OAuth ${this.token}`,
      "Content-Type": "application/json",
    };
    if (this.orgId) headers["X-Org-ID"] = this.orgId;
    if (this.cloudOrgId) headers["X-Cloud-Org-Id"] = this.cloudOrgId;
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      method,
      signal: AbortSignal.timeout(30000),
      headers: this.headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      await res.body?.cancel();
      throw new YTApiError(
        res.status,
        "Tracker request failed. Check credentials, permissions and mappings.",
        path,
      );
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ── Issues ──────────────────────────────────────────────────────────────────

  async getIssuesPaginated(options: {
    queue: string;
    updatedAfter?: Date | undefined;
    page?: number;
    perPage?: number;
  }) {
    const page = options.page ?? 1,
      perPage = options.perPage ?? 50;
    const issues = await this.request<YTIssue[]>(
      "POST",
      "/issues/_search",
      {
        filter: {
          queue: options.queue,
          ...(options.updatedAfter
            ? { updatedAt: { from: options.updatedAfter.toISOString() } }
            : {}),
        },
        order: ["+key"],
      },
      { page: String(page), perPage: String(perPage) },
    );
    return { issues, total: issues.length, hasMore: issues.length === perPage };
  }

  async getIssue(key: string): Promise<YTIssue> {
    return this.request<YTIssue>("GET", `/issues/${encodeURIComponent(key)}`);
  }

  async findByUnique(unique: string): Promise<YTIssue | undefined> {
    // Same recovery endpoint used by Yandex's official Python client.
    try {
      return await this.request<YTIssue>(
        "POST",
        "/issues/_findByUnique",
        undefined,
        { unique },
      );
    } catch (error) {
      if (error instanceof YTApiError && error.status === 404) return undefined;
      throw error;
    }
  }
  async createIssue(data: YTIssueCreate): Promise<YTIssue> {
    return this.request<YTIssue>("POST", "/issues/", data);
  }

  async updateIssue(
    key: string,
    data: YTIssueUpdate,
    version?: number,
  ): Promise<YTIssue> {
    return this.request<YTIssue>(
      "PATCH",
      `/issues/${encodeURIComponent(key)}`,
      data,
      version === undefined ? undefined : { version: String(version) },
    );
  }

  // ── Transitions (for status changes) ────────────────────────────────────────

  async getTransitions(key: string): Promise<YTTransition[]> {
    return this.request<YTTransition[]>(
      "GET",
      `/issues/${encodeURIComponent(key)}/transitions`,
    );
  }

  async executeTransition(
    key: string,
    transitionId: string,
    comment?: string,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (comment) body.comment = comment;
    return this.request<void>(
      "POST",
      `/issues/${encodeURIComponent(key)}/transitions/${encodeURIComponent(transitionId)}/_execute`,
      body,
    );
  }

  // ── Worklogs ─────────────────────────────────────────────────────────────────

  async getWorklogs(key: string): Promise<YTWorklog[]> {
    return this.request<YTWorklog[]>(
      "GET",
      `/issues/${encodeURIComponent(key)}/worklog`,
    );
  }

  async addWorklog(
    key: string,
    entry: { start: Date; durationMinutes: number; comment?: string },
  ): Promise<YTWorklog> {
    const duration = minutesToIsoDuration(entry.durationMinutes);
    return this.request<YTWorklog>(
      "POST",
      `/issues/${encodeURIComponent(key)}/worklog`,
      {
        start: entry.start.toISOString(),
        duration,
        ...(entry.comment && { comment: entry.comment }),
      },
    );
  }

  async getComments(key: string): Promise<YTComment[]> {
    const result: YTComment[] = [];
    let after = "";
    for (;;) {
      const page = await this.request<YTComment[]>(
        "GET",
        `/issues/${encodeURIComponent(key)}/comments`,
        undefined,
        { perPage: "100", ...(after ? { id: after } : {}) },
      );
      result.push(...page);
      if (page.length < 100) return result;
      const next = String(page[page.length - 1]!.id);
      if (next === after)
        throw new Error("Tracker comment pagination did not advance.");
      after = next;
    }
  }
  createComment(key: string, text: string) {
    return this.request<YTComment>(
      "POST",
      `/issues/${encodeURIComponent(key)}/comments`,
      { text, markupType: "md" },
    );
  }
  updateComment(key: string, id: string, text: string) {
    return this.request<YTComment>(
      "PATCH",
      `/issues/${encodeURIComponent(key)}/comments/${encodeURIComponent(id)}`,
      { text, markupType: "md" },
    );
  }
  async getUsers(): Promise<Array<{ id: string; display: string }>> {
    const result: Array<{ id: string; display: string }> = [];
    for (let page = 1; ; page++) {
      const users = await this.request<Array<{ id: string; display: string }>>(
        "GET",
        "/users",
        undefined,
        { page: String(page), perPage: "100" },
      );
      result.push(...users);
      if (users.length < 100) return result;
    }
  }
  getFields(): Promise<YTField[]> {
    return this.request("GET", "/fields");
  }

  // ── Queue ────────────────────────────────────────────────────────────────────

  async getQueues(): Promise<YTQueue[]> {
    return this.request<YTQueue[]>("GET", "/queues");
  }

  async getQueue(queueKey: string): Promise<YTQueue> {
    return this.request<YTQueue>(
      "GET",
      `/queues/${encodeURIComponent(queueKey)}`,
    );
  }

  async getQueueStatuses(queueKey: string): Promise<YTStatus[]> {
    return this.request<YTStatus[]>(
      "GET",
      `/queues/${encodeURIComponent(queueKey)}/statuses`,
    );
  }

  async getQueueFields(queueKey: string): Promise<YTField[]> {
    return this.request<YTField[]>(
      "GET",
      `/queues/${encodeURIComponent(queueKey)}/localFields`,
    );
  }

  // ── Global statuses ──────────────────────────────────────────────────────────

  async getStatuses(): Promise<YTStatus[]> {
    return this.request<YTStatus[]>("GET", "/statuses");
  }

  // ── Priorities ───────────────────────────────────────────────────────────────

  async getPriorities(): Promise<YTStatus[]> {
    return this.request<YTStatus[]>("GET", "/priorities");
  }

  // ── Issue types ──────────────────────────────────────────────────────────────

  async getIssueTypes(): Promise<YTStatus[]> {
    return this.request<YTStatus[]>("GET", "/issuetypes");
  }

  // ── Test connection ──────────────────────────────────────────────────────────

  async testConnection(
    queueKey: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await this.getQueue(queueKey);
      return { success: true };
    } catch (err) {
      if (err instanceof YTApiError) {
        if (err.status === 401)
          return { success: false, message: "Invalid OAuth token" };
        if (err.status === 403)
          return {
            success: false,
            message: "Access denied — check token permissions",
          };
        if (err.status === 404)
          return {
            success: false,
            message: `Queue "${encodeURIComponent(queueKey)}" not found`,
          };
        return { success: false, message: err.message };
      }
      return { success: false, message: String(err) };
    }
  }

  async getIssueCount(queue: string, updatedAfter?: Date): Promise<number> {
    const { total } = await this.getIssuesPaginated({
      queue,
      updatedAfter,
      perPage: 1,
    });
    return total;
  }
}

export class YTApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly path: string,
  ) {
    super(`YT API ${status} ${path}: ${message}`);
    this.name = "YTApiError";
  }
}

// Convert minutes to ISO 8601 duration used by YT (e.g. 90 → "PT1H30M")
export function minutesToIsoDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `PT${h}H${m}M`;
  if (h > 0) return `PT${h}H`;
  return `PT${m}M`;
}

// Parse ISO 8601 duration from YT to minutes (approximate — 1 week=5d, 1d=8h)
export function isoDurationToMinutes(duration: string): number {
  const weekMatch = duration.match(/(\d+)W/);
  const dayMatch = duration.match(/(\d+)D/);
  const hourMatch = duration.match(/(\d+)H/);
  const minMatch = duration.match(/(\d+)M(?!S)/); // M not followed by S

  const weeks = weekMatch ? parseInt(weekMatch[1]!) : 0;
  const days = dayMatch ? parseInt(dayMatch[1]!) : 0;
  const hours = hourMatch ? parseInt(hourMatch[1]!) : 0;
  const mins = minMatch ? parseInt(minMatch[1]!) : 0;

  return weeks * 5 * 8 * 60 + days * 8 * 60 + hours * 60 + mins;
}
