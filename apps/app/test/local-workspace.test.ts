import assert from "node:assert/strict";
import { test } from "node:test";
import { isT3Preview } from "../../../packages/frontend/src/lib/local-app-launch";
import {
  preferredLocalRepositoryId,
  readLocalWorkspace,
  saveLocalWorkspace,
} from "../../../packages/frontend/src/lib/local-workspace";
import { localAppLaunch } from "@spectron/shared";

test("T3 preview disables OS protocol navigation without disabling ordinary browsers", () => {
  assert.equal(
    isT3Preview(
      "Mozilla/5.0 T3Code(Alpha)/0.0.45 Chrome/152.0.7977.130 Electron/44.4.2 Safari/537.36",
    ),
    true,
  );
  assert.equal(
    isT3Preview(
      "Mozilla/5.0 T3Code/1.0.0 Chrome/152.0.7977.130 Electron/44.4.2 Safari/537.36",
    ),
    true,
  );
  assert.equal(
    isT3Preview("Mozilla/5.0 Chrome/152.0.7977.130 Safari/537.36"),
    false,
  );
  assert.equal(isT3Preview("Mozilla/5.0 Version/26.0 Safari/605.1.15"), false);
  assert.equal(isT3Preview("Mozilla/5.0 Electron/44.4.2 Safari/537.36"), false);
});

test("workspace selection preserves separate repository, project and account folders", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent() {} },
  });
  try {
    const a = {
      repositoryId: "repo-a",
      path: "/Users/me/app",
      originUrl: "https://github.com/team/app.git",
    };
    const b = {
      repositoryId: "repo-b",
      path: "/Users/me/api",
      originUrl: "git@github.com:team/api.git",
    };
    saveLocalWorkspace("me", "project", a);
    saveLocalWorkspace("me", "project", b);
    assert.deepEqual(readLocalWorkspace("me", "project"), b);
    // An old handoff without a repository must use a mapping saved later.
    const oldHandoffWorkspace = readLocalWorkspace("me", "project", null);
    assert.deepEqual(oldHandoffWorkspace, b);
    assert.equal(
      new URL(
        localAppLaunch("codex", "Issue summary", oldHandoffWorkspace).url,
      ).searchParams.get("path"),
      b.path,
    );
    assert.deepEqual(readLocalWorkspace("me", "project", "repo-a"), a);
    assert.equal(readLocalWorkspace("me", "project", "").path, "");
    assert.equal(
      readLocalWorkspace("someone-else", "project", "repo-a").path,
      "",
    );
    assert.equal(
      readLocalWorkspace("me", "another-project", "repo-a").path,
      "",
    );
    const unlinked = {
      repositoryId: "",
      path: "/Users/me/unlinked",
      originUrl: "",
    };
    saveLocalWorkspace("me", "project", unlinked);
    assert.deepEqual(readLocalWorkspace("me", "project"), unlinked);
    assert.deepEqual(readLocalWorkspace("me", "project", "repo-b"), b);
    assert.throws(
      () => saveLocalWorkspace("me", "project", { ...a, path: "~/repo" }),
      /absolute folder/,
    );
    assert.throws(
      () =>
        saveLocalWorkspace("me", "project", {
          ...a,
          originUrl: "https://secret@github.com/team/app",
        }),
      /without a password or token/,
    );
    values.set("spectron:local-workspace:me:project:repo-a", "invalid JSON");
    assert.equal(readLocalWorkspace("me", "project", "repo-a").path, "");
  } finally {
    if (previousStorage)
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("an unlinked local folder is not replaced by the project's default repository", () => {
  const repos = [
    { id: "repo-a", isDefault: true },
    { id: "repo-b", isDefault: false },
  ];
  assert.equal(
    preferredLocalRepositoryId(
      { repositoryId: "", path: "/Users/me/local project", originUrl: "" },
      repos,
    ),
    null,
  );
  assert.equal(
    preferredLocalRepositoryId(
      {
        repositoryId: "",
        path: "",
        originUrl: "git@github.com:team/other.git",
      },
      repos,
    ),
    null,
  );
  assert.equal(
    preferredLocalRepositoryId(
      { repositoryId: "repo-b", path: "/Users/me/api", originUrl: "" },
      repos,
    ),
    "repo-b",
  );
  assert.equal(
    preferredLocalRepositoryId(
      { repositoryId: "", path: "", originUrl: "" },
      repos,
    ),
    "repo-a",
  );
});
