/**
 * Off-site backup: config reading and the rclone invocation contract.
 *
 * The upload must never throw, must skip cleanly when rclone is absent, and —
 * because rclone's remote lives in RCLONE_CONFIG_* environment variables — must
 * hand credentials to the child through the environment, never as argv (argv is
 * visible in a process list). This pins all of that with a fake spawn.
 */
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import {
  DEFAULT_REMOTE,
  offsiteConfigured,
  readRcloneConfig,
  uploadBackup,
  type RcloneConfig,
} from "../server/offsiteBackup.js";

const FULL: RcloneConfig = {
  type: "s3",
  provider: "Cloudflare",
  accessKeyId: "AKIA-test",
  secretAccessKey: "super-secret",
  endpoint: "https://acct.r2.cloudflarestorage.com",
  remote: DEFAULT_REMOTE,
};

type SpawnFn = Parameters<typeof uploadBackup>[2];

function fakeSpawn(behavior: "enoent" | "ok" | "fail"): {
  fn: SpawnFn;
  calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }>;
} {
  const calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const fn = ((cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, env: opts.env });
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (behavior === "enoent") {
        const err = new Error("spawn rclone ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        child.emit("error", err);
      } else if (behavior === "ok") {
        child.emit("close", 0);
      } else {
        child.stderr.emit("data", Buffer.from("fatal: bucket not found"));
        child.emit("close", 1);
      }
    });
    return child;
  }) as unknown as SpawnFn;
  return { fn, calls };
}

export async function runOffsiteBackupTests(): Promise<void> {
  /* ------------------------------------------------ reading the config */
  const empty = readRcloneConfig({});
  assert.equal(empty.remote, DEFAULT_REMOTE, "remote defaults to the R2 bucket");
  assert.equal(empty.type, "", "missing keys read as empty, not undefined");

  const cfg = readRcloneConfig({
    RCLONE_CONFIG_R2_TYPE: "s3",
    RCLONE_CONFIG_R2_PROVIDER: "Cloudflare",
    RCLONE_CONFIG_R2_ACCESS_KEY_ID: "AKIA-test",
    RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: "super-secret",
    RCLONE_CONFIG_R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
    BACKUP_REMOTE: "  r2:custom-bucket/  ",
  });
  assert.equal(cfg.remote, "r2:custom-bucket/", "BACKUP_REMOTE overrides the default, trimmed");
  assert.equal(cfg.endpoint, "https://acct.r2.cloudflarestorage.com");

  assert.equal(offsiteConfigured(FULL), true, "a complete config is usable");
  assert.equal(offsiteConfigured({ ...FULL, secretAccessKey: "" }), false, "a missing secret is not usable");

  /* ------------------------------------------------ incomplete config never spawns */
  const noConfig = fakeSpawn("ok");
  const skipped = await uploadBackup("/tmp/backups", { ...FULL, accessKeyId: "" }, noConfig.fn);
  assert.equal(skipped.status, "skipped", "an incomplete config skips");
  assert.equal(noConfig.calls.length, 0, "rclone is not spawned without config");

  /* ------------------------------------------------ rclone missing */
  const missing = fakeSpawn("enoent");
  const enoent = await uploadBackup("/tmp/backups", FULL, missing.fn);
  assert.equal(enoent.status, "skipped", "a missing binary is a skip, not a crash");
  assert.match(enoent.detail ?? "", /not installed/);

  /* ------------------------------------------------ success + argv/env contract */
  const ok = fakeSpawn("ok");
  const uploaded = await uploadBackup("/var/data/backups", FULL, ok.fn);
  assert.equal(uploaded.status, "uploaded");
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.calls[0]!.cmd, "rclone");
  assert.deepEqual(
    ok.calls[0]!.args,
    ["copy", "/var/data/backups", DEFAULT_REMOTE],
    "usage is `rclone copy <dir> <remote>`",
  );
  assert.ok(
    !ok.calls[0]!.args.some((a) => a.includes("super-secret")),
    "the secret never appears in argv (visible in a process list)",
  );
  assert.equal(
    ok.calls[0]!.env.RCLONE_CONFIG_R2_SECRET_ACCESS_KEY,
    "super-secret",
    "the secret travels via env",
  );
  assert.equal(ok.calls[0]!.env.RCLONE_CONFIG_R2_ENDPOINT, FULL.endpoint);

  /* ------------------------------------------------ rclone error */
  const bad = fakeSpawn("fail");
  const failed = await uploadBackup("/var/data/backups", FULL, bad.fn);
  assert.equal(failed.status, "failed", "a non-zero exit is a failure result, not a rejection");
  assert.match(failed.detail ?? "", /exited 1/);

  console.log("  offsiteBackup: config gate, graceful ENOENT, env-only secrets, copy argv OK");
}
