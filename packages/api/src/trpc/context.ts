import type {
  Auth,
  AgentRunService,
  AIService,
  GitService,
  ExportService,
  TrackerService,
  FieldService,
  JiraService,
  ActivityService,
  WorklogService,
  CommentService,
  IssueService,
  FileService,
  ProjectService,
  InvitationService,
  ApiTokenService,
  OAuthAppService,
} from "@spectron/backend";

export type Context = {
  userId: string | null;
  apiTokens: ApiTokenService;
  oauthApps: OAuthAppService;
  runs: AgentRunService;
  gitWorkflow: ReturnType<typeof import("@spectron/backend").createGitWorkflow>;
  ai: AIService;
  handoffs: import("@spectron/backend").LocalHandoffService;
  git: GitService;
  exports: ExportService;
  tracker: TrackerService;
  fields: FieldService;
  jira: JiraService;
  projects: ProjectService;
  invitations: InvitationService;
  issues: IssueService;
  files: FileService;
  comments: CommentService;
  worklogs: WorklogService;
  activity: ActivityService;
};
export async function createContext(
  auth: Auth,
  projects: ProjectService,
  invitations: InvitationService,
  request: Request,
  issues: IssueService,
  files: FileService,
  comments: CommentService,
  worklogs: WorklogService,
  activity: ActivityService,
  fields: FieldService,
  jira: JiraService,
  tracker: TrackerService,
  exports: ExportService,
  ai: AIService,
  git: GitService,
  runs: AgentRunService,
  gitWorkflow: Context["gitWorkflow"],
  handoffs: Context["handoffs"],
  apiTokens: ApiTokenService,
  oauthApps: OAuthAppService,
): Promise<Context> {
  const session = await auth.api.getSession({ headers: request.headers });
  return {
    userId: session?.user.id || null,
    apiTokens,
    oauthApps,
    ai,
    handoffs,
    runs,
    gitWorkflow,
    git,
    tracker,
    exports,
    projects,
    invitations,
    issues,
    files,
    comments,
    worklogs,
    activity,
    fields,
    jira,
  };
}
