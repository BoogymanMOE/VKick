/**
 * Off-site backup: config reading and the git invocation contract.
 *
 * The push must never throw, must skip cleanly when BACKUP_GIT_URL is unset or
 * the working dir is not a git repo, must copy the snapshot into the repo's
 * `backups/` folder and run `git add` / `git commit` / `git push`, and must
 * treat a git-absent or failing night as a result (not a crash). Pinned with a
 * fake spawn so no real git runs.
 */
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BACKUP_FOLDER,
  COMMIT_MESSAGE,
  pushSnapshotToGit,
  readGitBackupConfig,
} from "../server/offsiteBackup.js";

type SpawnFn = Parameters<typeof pushSnapshotToGit>[2];

const URL = "https://user:token@github.com/example/vkick.git";
/** Subcommands we recognise, in match order ("remote" before "add"). */
const SUBCOMMANDS = ["remote", "commit", "push", "add"];

interface Behavior {
  code: number;
  stderr?: string;
  error?: string;
}

function fakeGit(behaviors: Record<string, Behavior>): {
  fn: SpawnFn;
  calls: Array<{ args: string[]; cwd: string }>;
} {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const fn = ((cmd: string, args: string[], opts: { cwd: string }) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    const sub = SUBCOMMANDS.find((s) => args.includes(s)) ?? "";
    const b = behaviors[sub] ?? { code: 0 };
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (b.error) {
        const err = new Error(`spawn git ${b.error}`) as NodeJS.ErrnoException;
        err.code = b.error;
        child.emit("error", err);
        return;
      }
      if (b.stderr) child.stderr.emit("data", Buffer.from(b.stderr));
      child.emit("close", b.code);
    });
    return child;
  }) as unknown as SpawnFn;
  return { fn, calls };
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-gitbk-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  return dir;
}

export async function runOffsiteBackupTests(): Promise<void> {
  /* ------------------------------------------------ reading the config */
  const empty = readGitBackupConfig({});
  assert.equal(empty.url, "", "a missing URL reads as empty");
  const cfg = readGitBackupConfig({ BACKUP_GIT_URL: `  ${URL}  ` });
  assert.equal(cfg.url, URL, "BACKUP_GIT_URL is read and trimmed");

  /* ------------------------------------------------ no URL → skip, never spawns */
  const noUrl = fakeGit({});
  const noUrlRes = await pushSnapshotToGit("/tmp/x.db", { url: "", repoDir: "/tmp" }, noUrl.fn);
  assert.equal(noUrlRes.status, "skipped", "no URL skips");
  assert.equal(noUrl.calls.length, 0, "git is not spawned without a URL");

  /* ------------------------------------------------ not a git repo → skip */
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-plain-"));
  const noGit = fakeGit({});
  const noGitRes = await pushSnapshotToGit("/tmp/x.db", { url: URL, repoDir: plainDir }, noGit.fn);
  assert.equal(noGitRes.status, "skipped", "a non-repo working dir skips");
  assert.equal(noGit.calls.length, 0, "git is not spawned outside a repo");

  /* ------------------------------------------------ happy path: copy + add + commit + push */
  const repoDir = makeRepo();
  const snapshot = path.join(repoDir, "snapshot-src.db");
  fs.writeFileSync(snapshot, "sqlite-bytes");
  const ok = fakeGit({ remote: { code: 0 }, add: { code: 0 }, commit: { code: 0 }, push: { code: 0 } });
  const pushed = await pushSnapshotToGit(snapshot, { url: URL, repoDir }, ok.fn);
  assert.equal(pushed.status, "pushed", "a clean run pushes");

  // The snapshot is copied into the repo's backups/ folder under its own name.
  const dest = path.join(repoDir, BACKUP_FOLDER, "snapshot-src.db");
  assert.ok(fs.existsSync(dest), "the snapshot is copied into backups/");
  assert.equal(fs.readFileSync(dest, "utf8"), "sqlite-bytes");

  // One call per git step, in order, all inside the repo.
  const subs = ok.calls.map((c) => SUBCOMMANDS.find((s) => c.args.includes(s)));
  assert.deepEqual(subs, ["remote", "add", "commit", "push"], "runs add → commit → push");
  assert.equal(ok.calls[0]!.args.includes(URL), true, "the remote URL is configured from BACKUP_GIT_URL");
  assert.equal(
    ok.calls[1]!.args.includes(`backups${path.sep}snapshot-src.db`) ||
      ok.calls[1]!.args.includes("backups/snapshot-src.db"),
    true,
    "git add targets the copied snapshot",
  );
  assert.ok(ok.calls[2]!.args.includes(COMMIT_MESSAGE), "the commit message is fixed");
  assert.equal(ok.calls[0]!.cwd, repoDir, "git runs inside the repo");

  /* ------------------------------------------------ nothing to commit → skip, not fail */
  const clean = makeRepo();
  const snap2 = path.join(clean, "snapshot-src.db");
  fs.writeFileSync(snap2, "same");
  const nothing = fakeGit({
    remote: { code: 0 },
    add: { code: 0 },
    commit: { code: 1, stderr: "nothing to commit, working tree clean" },
  });
  const nothingRes = await pushSnapshotToGit(snap2, { url: URL, repoDir: clean }, nothing.fn);
  assert.equal(nothingRes.status, "skipped", "an unchanged snapshot is a skip");

  /* ------------------------------------------------ git push fails → failed result */
  const failRepo = makeRepo();
  const snap3 = path.join(failRepo, "snapshot-src.db");
  fs.writeFileSync(snap3, "v3");
  const fail = fakeGit({
    remote: { code: 0 },
    add: { code: 0 },
    commit: { code: 0 },
    push: { code: 1, stderr: "fatal: could not read from remote repository" },
  });
  const failRes = await pushSnapshotToGit(snap3, { url: URL, repoDir: failRepo }, fail.fn);
  assert.equal(failRes.status, "failed", "a non-zero push is a failure result, not a rejection");
  assert.match(failRes.detail ?? "", /could not read/);

  /* ------------------------------------------------ git binary missing → failed, never throws */
  const enoent = fakeGit({ remote: { error: "ENOENT" } });
  const enoentRes = await pushSnapshotToGit(snap3, { url: URL, repoDir: failRepo }, enoent.fn);
  assert.equal(enoentRes.status, "failed", "a missing git binary is a failure result");

  for (const d of [repoDir, plainDir, clean, failRepo]) fs.rmSync(d, { recursive: true, force: true });
  console.log("  offsiteBackup: config gate, copy → add → commit → push, graceful failures OK");
}
