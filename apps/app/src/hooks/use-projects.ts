import { useCallback, useEffect, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import type { CreateProjectInput, ProjectSummary } from "@spectron/shared";
import { trpc } from "../lib/trpc";

export function useProjects(sessionId: string) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const dismissalKey = `spectron:project-onboarding:${sessionId}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(dismissalKey) === "skipped";
    } catch {
      return false;
    }
  });
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const rows = await trpc.projects.list.query();
      if (request !== version.current) return;
      setProjects(rows);
      setError("");
    } catch (cause) {
      if (request !== version.current) return;
      if (
        cause instanceof TRPCClientError &&
        cause.data?.code === "UNAUTHORIZED"
      ) {
        window.location.replace("/login");
        return;
      }
      setError("Couldn’t load your projects. Please try again.");
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      version.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const closeCreate = () => {
    setCreateOpen(false);
    setDismissed(true);
    try {
      sessionStorage.setItem(dismissalKey, "skipped");
    } catch {
      /* Storage is optional. */
    }
  };
  const create = async (input: CreateProjectInput) => {
    const project = await trpc.projects.create.mutate(input);
    version.current++;
    setProjects((previous) => [
      ...previous.filter((item) => item.id !== project.id),
      project,
    ]);
    setError("");
    setLoading(false);
    setCreateOpen(false);
    return project;
  };
  const update = useCallback(async (id: string, input: CreateProjectInput) => {
    const project = await trpc.projects.update.mutate({ id, ...input });
    version.current++;
    setProjects((previous) =>
      previous.map((item) => (item.id === id ? project : item)),
    );
  }, []);
  const archive = useCallback(async (id: string) => {
    const project = await trpc.projects.archive.mutate({ id });
    version.current++;
    setProjects((previous) =>
      previous.map((item) => (item.id === id ? project : item)),
    );
  }, []);
  return {
    update,
    archive,
    projects,
    loading,
    error,
    refresh,
    create,
    closeCreate,
    openCreate: () => setCreateOpen(true),
    showCreate:
      createOpen || (!loading && !error && !projects.length && !dismissed),
  };
}
