/**
 * Tests for self-update — deploy mode detection, version info, update checking, and applying.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock variables (closure-based, safe across resetModules) ──────────

const _isEmbedded = vi.fn(() => false);
const _existsSync = vi.fn(() => true);
const _readFileSync = vi.fn(() => JSON.stringify({ version: "1.0.0" }));
const _execFileSync = vi.fn((): string => "");
const _execFileAsync = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

vi.mock("@src/paths.js", () => ({ isEmbedded: _isEmbedded, getRootDir: () => "/mock" }));
vi.mock("fs", () => ({ existsSync: _existsSync, readFileSync: _readFileSync, openSync: vi.fn(() => 99) }));
vi.mock("child_process", () => ({
  execFile: vi.fn(),
  execFileSync: _execFileSync,
  spawn: vi.fn(() => ({ unref: vi.fn(), pid: 12345 })),
}));
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("util")>();
  return { ...actual, promisify: vi.fn(() => _execFileAsync) };
});

// ── Import after mocks ───────────────────────────────────────────────

import type { ProxySelfUpdateResult } from "@src/self-update.js";

// Helper: dynamic import with fresh module state
async function importFresh() {
  return await import("@src/self-update.js");
}

type ExecResult = { stdout: string; stderr: string };

function ok(stdout = ""): ExecResult {
  return { stdout, stderr: "" };
}

function mockGitExec(overrides: Record<string, ExecResult | Error>) {
  _execFileAsync.mockImplementation(async (_cmd: string, args?: string[]) => {
    const key = (args ?? []).join(" ");
    const matched = overrides[key];
    if (matched instanceof Error) throw matched;
    if (matched) return matched;

    switch (key) {
      case "remote":
        return ok("origin\nupstream\n");
      case "rev-parse --abbrev-ref HEAD":
        return ok("master\n");
      case "symbolic-ref --short refs/remotes/upstream/HEAD":
        return ok("upstream/master\n");
      case "rev-parse --verify --quiet upstream/master":
        return ok("refs/remotes/upstream/master\n");
      case "rev-parse --verify --quiet origin/master":
        return ok("refs/remotes/origin/master\n");
      default:
        return ok("");
    }
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("self-update", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Default: non-embedded, .git exists, git works, package.json readable
    _isEmbedded.mockReturnValue(false);
    _existsSync.mockReturnValue(true);
    _readFileSync.mockReturnValue(JSON.stringify({ version: "1.0.0" }));
    _execFileSync.mockReturnValue("");
    _execFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  // ── getDeployMode ─────────────────────────────────────────────────

  describe("getDeployMode", () => {
    it("returns 'electron' when embedded", async () => {
      _isEmbedded.mockReturnValue(true);
      const { getDeployMode } = await importFresh();
      expect(getDeployMode()).toBe("electron");
    });

    it("returns 'git' when .git exists and git works", async () => {
      const { getDeployMode } = await importFresh();
      expect(getDeployMode()).toBe("git");
    });

    it("returns 'docker' when no .git directory", async () => {
      _existsSync.mockReturnValue(false);
      const { getDeployMode } = await importFresh();
      expect(getDeployMode()).toBe("docker");
    });
  });

  // ── getProxyInfo ──────────────────────────────────────────────────

  describe("getProxyInfo", () => {
    it("reads version from package.json", async () => {
      _readFileSync.mockReturnValue(JSON.stringify({ version: "1.2.3" }));
      const { getProxyInfo } = await importFresh();
      expect(getProxyInfo().version).toBe("1.2.3");
    });

    it("returns 'unknown' when package.json is unreadable", async () => {
      _readFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
      // .git doesn't exist so canSelfUpdate returns false, no git calls
      _existsSync.mockReturnValue(false);
      const { getProxyInfo } = await importFresh();
      expect(getProxyInfo().version).toBeNull();
    });

    it("returns commit hash when git is available", async () => {
      _execFileSync.mockReturnValue("abc1234\n");
      const { getProxyInfo } = await importFresh();
      const info = getProxyInfo();
      expect(info.commit).toBe("abc1234");
    });

    it("returns null commit when not in git mode", async () => {
      _existsSync.mockReturnValue(false);
      const { getProxyInfo } = await importFresh();
      expect(getProxyInfo().commit).toBeNull();
    });
  });

  // ── canSelfUpdate ─────────────────────────────────────────────────

  describe("canSelfUpdate", () => {
    it("returns false when embedded", async () => {
      _isEmbedded.mockReturnValue(true);
      const { canSelfUpdate } = await importFresh();
      expect(canSelfUpdate()).toBe(false);
    });

    it("returns false when .git is missing", async () => {
      _existsSync.mockReturnValue(false);
      const { canSelfUpdate } = await importFresh();
      expect(canSelfUpdate()).toBe(false);
    });

    it("returns true when git works", async () => {
      const { canSelfUpdate } = await importFresh();
      expect(canSelfUpdate()).toBe(true);
    });

    it("returns false when git command fails", async () => {
      _execFileSync.mockImplementation((cmd: string, args?: string[]) => {
        if (args && args[0] === "--version") throw new Error("git not found");
        return "";
      });
      const { canSelfUpdate } = await importFresh();
      expect(canSelfUpdate()).toBe(false);
    });
  });

  // ── checkProxySelfUpdate (git mode) ───────────────────────────────

  describe("checkProxySelfUpdate (git mode)", () => {
    it("returns updateAvailable=false when up to date", async () => {
      mockGitExec({
        "rev-parse --short HEAD": ok("abc1234\n"),
        "fetch upstream --quiet": ok(""),
        "rev-list HEAD..upstream/master --count": ok("0\n"),
        "rev-parse --short upstream/master": ok("abc1234\n"),
      });

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.updateAvailable).toBe(false);
      expect(result.commitsBehind).toBe(0);
      expect(result.commits).toEqual([]);
      expect(result.mode).toBe("git");
    });

    it("returns commits when behind", async () => {
      mockGitExec({
        "rev-parse --short HEAD": ok("aaa1111\n"),
        "fetch upstream --quiet": ok(""),
        "rev-list HEAD..upstream/master --count": ok("3\n"),
        "rev-parse --short upstream/master": ok("bbb2222\n"),
        "log HEAD..upstream/master --oneline --format=%h %s": ok(
          "ccc3333 fix: bug\nddd4444 feat: new\neee5555 chore: cleanup\n",
        ),
        "show upstream/master:CHANGELOG.md": ok("## [Unreleased]\n\n- item\n"),
      });

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.updateAvailable).toBe(true);
      expect(result.commitsBehind).toBe(3);
      expect(result.commits).toHaveLength(3);
      expect(result.currentCommit).toBe("aaa1111");
      expect(result.latestCommit).toBe("bbb2222");
    });

    it("populates commit log correctly", async () => {
      mockGitExec({
        "rev-parse --short HEAD": ok("aaa\n"),
        "fetch upstream --quiet": ok(""),
        "rev-list HEAD..upstream/master --count": ok("2\n"),
        "rev-parse --short upstream/master": ok("bbb\n"),
        "log HEAD..upstream/master --oneline --format=%h %s": ok(
          "abc1234 fix: something broke\ndef5678 feat: add widget\n",
        ),
        "show upstream/master:CHANGELOG.md": ok("## [Unreleased]\n\n- item\n"),
      });

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.commits[0]).toEqual({ hash: "abc1234", message: "fix: something broke" });
      expect(result.commits[1]).toEqual({ hash: "def5678", message: "feat: add widget" });
    });

    it("prefers upstream over origin when both remotes exist", async () => {
      mockGitExec({
        "rev-parse --short HEAD": ok("aaa\n"),
        "fetch upstream --quiet": ok(""),
        "rev-list HEAD..upstream/master --count": ok("0\n"),
        "rev-list HEAD..origin/master --count": ok("5\n"),
        "rev-parse --short upstream/master": ok("aaa\n"),
      });

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.updateAvailable).toBe(false);
      expect(_execFileAsync).toHaveBeenCalledWith(
        "git",
        ["rev-list", "HEAD..upstream/master", "--count"],
        expect.any(Object),
      );
    });

    it("handles git fetch failure gracefully", async () => {
      mockGitExec({
        "rev-parse --short HEAD": ok("aaa\n"),
        "fetch upstream --quiet": new Error("network error"),
      });

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.updateAvailable).toBe(false);
      expect(result.commitsBehind).toBe(0);
      expect(result.currentCommit).toBe("aaa");
    });
  });

  // ── checkProxySelfUpdate (docker mode) ────────────────────────────

  describe("checkProxySelfUpdate (docker mode)", () => {
    beforeEach(() => {
      // No .git → docker mode
      _existsSync.mockReturnValue(false);
    });

    // Helper: mock GHCR token + tags + optional GitHub Release
    function mockDockerFetch(
      registryTags: string[],
      releaseData?: { tag_name: string; body: string; html_url: string; published_at: string },
    ): ReturnType<typeof vi.fn> {
      const mockFetch = vi.fn()
        // 1st call: GHCR token
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: "anon-token" }),
        })
        // 2nd call: GHCR tags
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ name: "icebear0828/codex-proxy", tags: registryTags }),
          headers: new Headers(),
        });

      // 3rd call: GitHub Release (if update detected)
      if (releaseData) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(releaseData),
        });
      }

      vi.stubGlobal("fetch", mockFetch);
      return mockFetch;
    }

    it("returns release when update available in registry", async () => {
      _readFileSync.mockReturnValue(JSON.stringify({ version: "1.0.0" }));

      mockDockerFetch(
        ["latest", "v1.0.0", "v2.0.0"],
        {
          tag_name: "v2.0.0",
          body: "New release notes",
          html_url: "https://github.com/repo/releases/v2.0.0",
          published_at: "2026-03-09T00:00:00Z",
        },
      );

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.updateAvailable).toBe(true);
      expect(result.release).not.toBeNull();
      expect(result.release!.version).toBe("2.0.0");
      expect(result.release!.body).toBe("New release notes");
      expect(result.mode).toBe("docker");

      vi.unstubAllGlobals();
    });

    it("returns no update when registry version matches current", async () => {
      _readFileSync.mockReturnValue(JSON.stringify({ version: "2.0.0" }));

      mockDockerFetch(["latest", "v2.0.0"]);

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.updateAvailable).toBe(false);
      expect(result.release).toBeNull();

      vi.unstubAllGlobals();
    });

    it("no false positive: registry has same version even if GitHub Release is newer", async () => {
      // Registry only has v2.0.44 (image not yet published for v2.0.45)
      _readFileSync.mockReturnValue(JSON.stringify({ version: "2.0.44" }));

      mockDockerFetch(["latest", "v2.0.44"]);

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.updateAvailable).toBe(false);
      expect(result.release).toBeNull();

      vi.unstubAllGlobals();
    });

    it("synthesizes release info when GitHub Release unavailable", async () => {
      _readFileSync.mockReturnValue(JSON.stringify({ version: "1.0.0" }));

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: "t" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ tags: ["latest", "v2.0.0"] }),
          headers: new Headers(),
        })
        // GitHub Release returns 404
        .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });
      vi.stubGlobal("fetch", mockFetch);

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.updateAvailable).toBe(true);
      expect(result.release).not.toBeNull();
      expect(result.release!.version).toBe("2.0.0");
      expect(result.release!.tag).toBe("v2.0.0");
      expect(result.release!.body).toBe("");

      vi.unstubAllGlobals();
    });

    it("handles GHCR registry error gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network failure"));
      vi.stubGlobal("fetch", mockFetch);

      const { checkProxySelfUpdate } = await importFresh();
      const result = await checkProxySelfUpdate();
      expect(result.updateAvailable).toBe(false);
      expect(result.release).toBeNull();

      vi.unstubAllGlobals();
    });
  });

  // ── getCachedProxyUpdateResult ────────────────────────────────────

  describe("getCachedProxyUpdateResult", () => {
    it("returns null before first check", async () => {
      const { getCachedProxyUpdateResult } = await importFresh();
      expect(getCachedProxyUpdateResult()).toBeNull();
    });

    it("returns result after check", async () => {
      mockGitExec({
        "rev-parse --short HEAD": ok("aaa\n"),
        "fetch upstream --quiet": ok(""),
        "rev-list HEAD..upstream/master --count": ok("0\n"),
        "rev-parse --short upstream/master": ok("aaa\n"),
      });

      const { checkProxySelfUpdate, getCachedProxyUpdateResult } = await importFresh();
      await checkProxySelfUpdate();
      const cached = getCachedProxyUpdateResult();
      expect(cached).not.toBeNull();
      expect(cached!.mode).toBe("git");
    });
  });

  // ── applyProxySelfUpdate ──────────────────────────────────────────

  describe("applyProxySelfUpdate", () => {
    it("runs git checkout + git pull + npm install + npm run build", async () => {
      mockGitExec({
        "fetch upstream --quiet": ok(""),
        "checkout -- .": ok(""),
        "pull upstream master": ok(""),
        "install": ok(""),
        "run build": ok(""),
      });

      const { applyProxySelfUpdate } = await importFresh();
      const result = await applyProxySelfUpdate();
      expect(result.started).toBe(true);
      expect(result.error).toBeUndefined();

      expect(_execFileAsync).toHaveBeenCalledWith("git", ["pull", "upstream", "master"], expect.any(Object));
    });

    it("returns error when step fails", async () => {
      mockGitExec({
        "fetch upstream --quiet": ok(""),
        "checkout -- .": ok(""),
        "pull upstream master": new Error("git pull failed"),
      });

      const { applyProxySelfUpdate } = await importFresh();
      const result = await applyProxySelfUpdate();
      expect(result.started).toBe(false);
      expect(result.error).toContain("git pull failed");
    });

    it("returns error when already in progress", async () => {
      // Keep the first update hanging at git fetch so the second call only exercises the in-progress guard.
      _execFileAsync.mockImplementation(async (_cmd: string, args?: string[]) => {
        const key = (args ?? []).join(" ");
        if (key === "remote") return ok("origin\nupstream\n");
        if (key === "fetch upstream --quiet") return await new Promise<ExecResult>(() => {});
        switch (key) {
          case "rev-parse --abbrev-ref HEAD":
            return ok("master\n");
          case "symbolic-ref --short refs/remotes/upstream/HEAD":
            return ok("upstream/master\n");
          case "rev-parse --verify --quiet upstream/master":
            return ok("refs/remotes/upstream/master\n");
          default:
            return ok("");
        }
      });

      const { applyProxySelfUpdate } = await importFresh();

      // Start first update (will hang on git fetch)
      const first = applyProxySelfUpdate();

      // Second call while first is in progress
      const second = await applyProxySelfUpdate();
      expect(second.started).toBe(false);
      expect(second.error).toContain("already in progress");
      void first;
    });
  });
});
