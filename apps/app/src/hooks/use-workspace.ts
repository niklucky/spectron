import { useEffect, useRef, useState } from "react";
import { useTheme } from "@spectron/frontend/hooks/use-theme";
import type { WorkspaceDialogName } from "@spectron/frontend/components/feature/workspace";
import type { Task, Project } from "@spectron/frontend/components/feature/task";
import type {
  Attachment,
  LocalMessage,
} from "@spectron/frontend/components/feature/chat";
function readRoute(projects: Project[], tasks: Record<string, Task[]>) {
  const parts = window.location.hash.slice(1).split("/");
  const flow = parts[0] === "flow" || !projects.length;
  const project =
    projects.find((item) => item.id === parts[1])?.id || projects[0]?.id || "";
  const id =
    (tasks[project] || []).find((item) => item.id === parts[2])?.id || "";
  return { flow, project, id };
}
const taskHash = (project: string, id: string, flow: boolean) =>
  flow
    ? id
      ? `#flow/${project}/${id}`
      : "#flow"
    : `#project/${project}${id ? `/${id}` : ""}`;
const activityAge = (time: string) =>
  time === "now"
    ? 0
    : Number.parseInt(time) *
      (time.endsWith("d") ? 1440 : time.endsWith("h") ? 60 : 1);

export function useWorkspace(initialName: string, projects: Project[]) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [project, setProject] = useState(() => readRoute(projects, {}).project);
  const [isFlow, setIsFlow] = useState(() => readRoute(projects, {}).flow);
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>(
    {},
  );
  const [selectedId, setSelectedId] = useState(
    () => readRoute(projects, {}).id,
  );
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const { theme, setTheme } = useTheme();
  const [modal, setModal] = useState<WorkspaceDialogName>(null);
  const [image, setImage] = useState("");
  const [details, setDetails] = useState(false);
  const [name, setName] = useState(initialName);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, LocalMessage[]>>({});
  const [attachments, setAttachments] = useState<
    Record<string, Attachment | undefined>
  >({});
  const [notice, setNotice] = useState("");
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTask = useRef(selectedId);
  const objectUrls = useRef<string[]>([]);
  const task = (tasksByProject[project] || []).find(
    (item) => item.id === selectedId,
  );
  const draft = drafts[selectedId] || "";
  const attachment = attachments[selectedId];
  const allTasks = Object.entries(tasksByProject)
    .filter(([id]) => projects.some((item) => item.id === id))
    .flatMap(([projectName, projectTasks]) =>
      projectTasks.map((item) => ({ ...item, project: projectName })),
    );
  const visibleTasks = isFlow
    ? allTasks.sort((a, b) => activityAge(a.time) - activityAge(b.time))
    : allTasks.filter((item) => item.project === project);
  const tasks = visibleTasks.filter(
    (item) =>
      `${projects.find((project) => project.id === item.project)?.name || ""} ${item.id} ${item.title} ${item.preview}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter !== "open" || item.status !== "Done") &&
      (filter !== "unread" || !!item.unread),
  );

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    historyRef.current?.scrollTo({ top: 0 });
    setDetails(false);
  }, [selectedId]);
  useEffect(
    () => () => {
      recorderRef.current?.state === "recording" && recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  useEffect(() => {
    const change = () => {
      const route = readRoute(projects, tasksByProject);
      setProject(route.project);
      setSelectedId(route.id);
      setIsFlow(route.flow);
      if (!route.id) setMobileChat(false);
    };
    const onHashChange = () => {
      change();
      setQuery("");
      setFilter("all");
    };
    change();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [tasksByProject, projects]);

  const openModal = (value: WorkspaceDialogName) => setModal(value);
  const selectTask = (id: string, owner: string) => {
    setProject(owner);
    setSelectedId(id);
    setMobileChat(true);
    history.replaceState(null, "", taskHash(owner, id, isFlow));
    setTasksByProject((previous) => ({
      ...previous,
      [owner]: previous[owner]!.map((item) =>
        item.id === id ? { ...item, unread: 0 } : item,
      ),
    }));
  };
  const selectFlow = () => {
    setIsFlow(true);
    setQuery("");
    setFilter("all");
    setMobileChat(false);
    history.replaceState(null, "", taskHash(project, selectedId, true));
  };
  const selectProject = (value: string) => {
    setIsFlow(false);
    setProject(value);
    const first = tasksByProject[value]?.[0];
    setSelectedId(first?.id || "");
    history.replaceState(null, "", taskHash(value, first?.id || "", false));
    setQuery("");
    setFilter("all");
    setMobileChat(false);
  };
  const updateTask = (changes: Partial<Task>) =>
    setTasksByProject((previous) => ({
      ...previous,
      [project]: (previous[project] || []).map((item) =>
        item.id === selectedId ? { ...item, ...changes } : item,
      ),
    }));
  const sendMessage = () => {
    if (!task || (!draft.trim() && !attachment) || recording) return;
    const message: LocalMessage = {
      id: crypto.randomUUID(),
      text: draft.trim(),
      time: new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      ...(attachment ? { attachment } : {}),
    };
    setMessages((previous) => ({
      ...previous,
      [selectedId]: [...(previous[selectedId] || []), message],
    }));
    setDrafts((previous) => ({ ...previous, [selectedId]: "" }));
    setAttachments((previous) => ({ ...previous, [selectedId]: undefined }));
    updateTask({
      preview: draft.trim() || attachment?.name || "New message",
      initials: name.slice(0, 2).toUpperCase(),
      color: "sage",
      time: "now",
      unread: 0,
    });
    requestAnimationFrame(() =>
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
    );
    composeRef.current?.focus();
  };
  const attachFile = (file: File, id = selectedId) => {
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    const kind = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("audio/")
        ? "audio"
        : file.type.startsWith("video/")
          ? "video"
          : "file";
    setAttachments((previous) => ({
      ...previous,
      [id]: { name: file.name, url, kind, size: file.size },
    }));
  };
  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setNotice("Voice recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recordingTask.current = selectedId;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const extension = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        attachFile(
          new File(chunks, `Voice recording.${extension}`, { type }),
          recordingTask.current,
        );
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      recorder.start();
      setRecording(true);
    } catch {
      setNotice(
        "Microphone unavailable. Allow access to record a voice message.",
      );
    }
  };
  const createTask = (title: string, destination: string) => {
    const owner = projects.find((item) => item.id === destination);
    if (!title.trim() || !owner) return;
    const prefix = owner.key;
    const number =
      1 +
      Math.max(
        0,
        ...Object.values(tasksByProject)
          .flat()
          .map((item) => Number(item.id.split("-").at(-1)) || 0),
      );
    const item: Task = {
      id: `${prefix}-${number}`,
      title: title.trim(),
      status: "Todo",
      updated: "Just now",
      preview: "Start the conversation",
      initials: name.slice(0, 2).toUpperCase(),
      color: "sage",
      time: "now",
    };
    setTasksByProject((previous) => ({
      ...previous,
      [destination]: [item, ...(previous[destination] || [])],
    }));
    setProject(destination);
    setSelectedId(item.id);
    history.replaceState(null, "", taskHash(destination, item.id, isFlow));
    setQuery("");
    setFilter("all");
    setMobileChat(true);
    setModal(null);
  };

  const setDraft = (value: string) =>
    setDrafts((previous) => ({ ...previous, [selectedId]: value }));
  const removeAttachment = () =>
    setAttachments((previous) => ({ ...previous, [selectedId]: undefined }));
  const copyTaskLink = () => {
    void navigator.clipboard
      .writeText(
        `${location.origin}${location.pathname}${taskHash(project, task?.id || "", isFlow)}`,
      )
      .then(
        () => setNotice("Task link copied"),
        () => setNotice("Could not access the clipboard."),
      );
  };
  return {
    collapsed,
    setCollapsed,
    mobileChat,
    setMobileChat,
    project,
    isFlow,
    selectedId,
    task,
    tasks,
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    filter,
    setFilter,
    theme,
    setTheme,
    modal,
    setModal,
    image,
    setImage,
    details,
    setDetails,
    name,
    setName,
    draft,
    setDraft,
    attachment,
    removeAttachment,
    recording,
    notice,
    showNotice: setNotice,
    messages: messages[selectedId] || [],
    historyRef,
    bottomRef,
    composeRef,
    openModal,
    selectTask,
    selectFlow,
    selectProject,
    updateTask,
    sendMessage,
    attachFile,
    toggleRecording,
    createTask,
    copyTaskLink,
  };
}
