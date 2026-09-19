import { firstMessageFields } from "@spectron/shared";
import {
  defaultTaskFilters,
  matchesResolvedDatePeriod,
  refreshDateClock,
  resolveDatePeriod,
  type TaskFilters,
} from "@spectron/frontend/components/feature/task";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  IssueFields,
  IssueSettings,
  IssueSummary,
} from "@spectron/shared";
import { useTheme } from "@spectron/frontend/hooks/use-theme";
import type { WorkspaceDialogName } from "@spectron/frontend/components/feature/workspace";
import type { Task, Project } from "@spectron/frontend/components/feature/task";
import { isProjectSection, type ProjectSection } from "@spectron/frontend/components/feature/project";
import { trpc } from "../lib/trpc";

export type WorkspaceView = "flow" | "overview" | "project";
type Route = {
  view: WorkspaceView;
  isFlow: boolean;
  project: string;
  section: ProjectSection;
  id: string;
};

/**
 * Hash routes:
 *   #flow                          inbox across projects
 *   #flow/:project/:issue          issue opened from the inbox
 *   #overview                      personal dashboard
 *   #project/:id                   project overview
 *   #project/:id/:section          wiki | issues | board | gantt | settings
 *   #project/:id/issues/:issue     issue inside the project
 *   #project/:id/:issue            legacy issue link, treated as issues/:issue
 */
function readRoute(projects: Project[]): Route {
  const parts = window.location.hash.slice(1).split("/");
  const project =
    projects.find((p) => p.id === parts[1])?.id || projects[0]?.id || "";
  if (parts[0] === "overview" && projects.length)
    return { view: "overview", isFlow: false, project, section: "overview", id: "" };
  if (parts[0] === "project" && projects.length) {
    const section: ProjectSection = isProjectSection(parts[2]) ? parts[2] : parts[2] ? "issues" : "overview";
    const id = isProjectSection(parts[2]) ? (section === "issues" ? parts[3] ?? "" : "") : parts[2] ?? "";
    return { view: "project", isFlow: false, project, section, id };
  }
  return { view: "flow", isFlow: true, project, section: "issues", id: parts[0] === "flow" ? parts[2] ?? "" : "" };
}
const taskHash = (project: string, id: string, flow: boolean) =>
  flow
    ? id
      ? `#flow/${project}/${id}`
      : "#flow"
    : `#project/${project}/issues${id ? `/${id}` : ""}`;
const sectionHash = (project: string, section: ProjectSection) =>
  section === "overview" ? `#project/${project}` : `#project/${project}/${section}`;

export function useWorkspace(
  initialName: string,
  projects: Project[],
  userId: string,
) {
  const [collapsed, setCollapsed] = useState(false);
  const [route, setRoute] = useState(() => readRoute(projects));
  const [mobileChat, setMobileChat] = useState(() => !!route.id);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [settings, setSettings] = useState<Record<string, IssueSettings>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const storageKey = `spectron:issue-filters:v1:${userId}`;
  const [filters, setFilters] = useState<Record<string, TaskFilters>>(() => {
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(storageKey) || "{}",
      );
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return {};
      return Object.fromEntries(
        Object.entries(parsed).map(([key, v]) => [key, v?.field === "type" ? { ...v, field: "trigger", values: [], typeIds: v.values } : { ...v, typeIds: v?.typeIds ?? (v?.typeId ? [v.typeId] : []) }]).filter(
          ([, v]) =>
            v &&
            (v.field === "state" || v.field === "trigger" || v.field === "type") &&
            Array.isArray(v.values) &&
            v.values.every((id: unknown) => typeof id === "string") &&
            typeof v.deleted === "boolean" &&
            Array.isArray(v.typeIds) &&
            v.typeIds.every((id: unknown) => typeof id === "string"),
        ),
      );
    } catch {
      return {};
    }
  });
  const filterScope = route.isFlow ? "flow" : route.project;
  const [filterClock, setFilterClock] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setFilterClock(previous => refreshDateClock(previous));
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const filter = resolveDatePeriod(filters[filterScope] ?? defaultTaskFilters, filterClock);
  const setFilter = (value: TaskFilters) =>
    setFilters((previous) => ({ ...previous, [filterScope]: value }));
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(filters));
    } catch {
      /* Storage may be disabled. */
    }
  }, [filters, storageKey]);
  const { theme, setTheme, palette, setPalette } = useTheme();
  const [modal, setModal] = useState<WorkspaceDialogName>(null);
  const [image] = useState("");
  const [name, setName] = useState(initialName);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const projectIds = projects
    .map((p) => p.id)
    .sort()
    .join(",");
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const ids = projectIds ? projectIds.split(",") : [];
    if (!ids.length) {
      setIssues([]);
      setSettings({});
      setLoading(false);
      return;
    }
    try {
      const rows = await Promise.all(
        ids.map(async (projectId) => ({
          projectId,
          issues: await trpc.issues.list.query({ projectId }),
          settings: await trpc.issues.settings.query({ projectId }),
        })),
      );
      if (request !== generation.current) return;
      setIssues(rows.flatMap((r) => r.issues));
      setSettings(
        Object.fromEntries(rows.map((r) => [r.projectId, r.settings])),
      );
      setError("");
    } catch {
      if (request === generation.current)
        setError("Couldn’t load issues. Please retry.");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [projectIds]);
  useEffect(() => {
    setLoading(true);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      generation.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  useEffect(() => {
    const onHashChange = () => {
      const next = readRoute(projects);
      setRoute(next);
      setQuery("");
      setMobileChat(!!next.id);
    };
    setRoute(readRoute(projects));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [projects]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const navigate = (project: string, id: string, isFlow: boolean) => {
    history.pushState(null, "", taskHash(project, id, isFlow));
    setRoute({ view: isFlow ? "flow" : "project", isFlow, project, section: "issues", id });
  };
  const navigateSection = (project: string, section: ProjectSection) => {
    history.pushState(null, "", sectionHash(project, section));
    setRoute({ view: "project", isFlow: false, project, section, id: "" });
  };
  const allTasks: Task[] = useMemo(
    () =>
      issues
        .filter((i) => projects.some((p) => p.id === i.projectId))
        .map((i) => {
          const state = settings[i.projectId]?.states.find(
            (s) => s.id === i.stateId,
          );
          return {
            ...i,
            status: state?.name ?? "Unknown state",
            statusTrigger: state?.trigger ?? "opened",
            stateColor: state?.color ?? null,
            updated: new Date(i.updatedAt).toLocaleDateString(),
            preview: i.description || "No description",
            initials: "",
            color: "sage",
            time: new Date(i.updatedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          };
        }),
    [issues, settings, projects],
  );
  const task = allTasks.find(
    (i) =>
      i.projectId === route.project &&
      (i.id === route.id || i.key === route.id),
  );
  const tasks = allTasks
    .filter(
      (i) =>
        (route.isFlow || i.projectId === route.project) &&
        (!route.isFlow || !filter.projectIds?.length || filter.projectIds.includes(i.projectId)) &&
        (filter.deleted ? !!i.deletedAt : !i.deletedAt) &&
        matchesResolvedDatePeriod(i, filter) &&
        (!filter.typeIds?.length || filter.typeIds.includes(i.issueTypeId ?? "")) &&
        (!filter.values.length ||
          filter.values.includes(
            filter.field === "trigger" ? i.statusTrigger : filter.field === "type" ? (i.issueTypeId ?? "") : i.stateId,
          )) &&
        `${i.key} ${i.title} ${i.description}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (b.lastActivity?.createdAt && b.lastActivity.createdAt > b.updatedAt
          ? b.lastActivity.createdAt
          : b.updatedAt
        ).localeCompare(
          a.lastActivity?.createdAt && a.lastActivity.createdAt > a.updatedAt
            ? a.lastActivity.createdAt
            : a.updatedAt,
        ) || b.number - a.number,
    )
    .map((i) => ({ ...i, project: i.projectId }));
  const apply = useCallback((row: IssueSummary) => {
    generation.current++;
    setLoading(false);
    setError("");
    setIssues((previous) => [...previous.filter((i) => i.id !== row.id), row]);
  }, []);
  const saveIssue = useCallback(
    async (row: IssueSummary, fields: Partial<IssueFields>) => {
      const updated = await trpc.issues.update.mutate({
        ...fields,
        id: row.id,
        projectId: row.projectId,
        expectedUpdatedAt: row.updatedAt,
      });
      apply(updated);
      await refresh();
    },
    [apply, refresh],
  );
  const setDeleted = useCallback(
    async (row: IssueSummary, deleted: boolean) => {
      const updated = await trpc.issues.setDeleted.mutate({
        id: row.id,
        projectId: row.projectId,
        expectedUpdatedAt: row.updatedAt,
        deleted,
      });
      apply(updated);
      await refresh();
    },
    [apply, refresh],
  );
  const createTask = async (
    title: string,
    projectId: string,
    projectFileIds: string[] = [],
  ) => {
    const row = await trpc.issues.create.mutate({
      projectId,
      ...firstMessageFields(title),
      projectFileIds,
    });
    apply(row);
    try {
      sessionStorage.setItem("issue-view", "chat");
    } catch {}
    await refresh();
    navigate(projectId, row.id, route.isFlow);
    setQuery("");
    setMobileChat(true);
    setModal(null);
  };
  return {
    collapsed,
    setCollapsed,
    mobileChat,
    setMobileChat,
    project: route.project,
    view: route.view,
    section: route.section,
    isFlow: route.isFlow,
    selectedId: task?.id ?? route.id,
    task,
    creatingIssue: route.id === "new",
    startNewIssue: () => {
      navigate(route.project, "new", route.isFlow);
      setMobileChat(true);
    },
    tasks,
    allIssues: issues,
    settings,
    loading,
    error,
    refresh,
    saveIssue,
    setDeleted,
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    filter,
    setFilter,
    theme,
    setTheme,
    palette,
    setPalette,
    modal,
    setModal,
    image,
    name,
    setName,
    notice,
    showNotice: setNotice,
    openModal: setModal,
    createTask,
    selectTask: (id: string, project: string) => {
      navigate(project, id, route.isFlow);
      setMobileChat(true);
    },
    selectFlow: () => {
      navigate(route.project, task?.id ?? "", true);
      setQuery("");
      setMobileChat(false);
    },
    selectProject: (id: string, section: ProjectSection = "overview") => {
      navigateSection(id, section);
      setQuery("");
      setMobileChat(false);
    },
    selectSection: (section: ProjectSection) => {
      navigateSection(route.project, section);
      setQuery("");
      setMobileChat(false);
    },
    selectOverview: () => {
      history.pushState(null, "", "#overview");
      setRoute({ view: "overview", isFlow: false, project: route.project, section: "overview", id: "" });
      setQuery("");
      setMobileChat(false);
    },
    copyTaskLink: () => {
      if (task)
        void navigator.clipboard
          .writeText(
            `${location.origin}${location.pathname}${taskHash(task.projectId, task.id, false)}`,
          )
          .then(
            () => setNotice("Issue link copied"),
            () => setNotice("Could not copy link"),
          );
    },
  };
}
