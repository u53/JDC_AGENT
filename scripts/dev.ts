import { spawn, type ChildProcess } from "node:child_process";

const processes: ChildProcess[] = [];

function cleanup() {
  for (const proc of processes) {
    if (proc.pid && !proc.killed) {
      proc.kill("SIGTERM");
    }
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("[dev] Starting Vite dev server...");

  const vite = spawn("pnpm", ["--filter", "@jdcagnet/ui", "dev"], {
    stdio: "inherit",
    env: { ...process.env, BROWSER: "none" },
  });
  processes.push(vite);

  vite.on("error", (err) => {
    console.error("[dev] Vite failed to start:", err.message);
    cleanup();
  });

  // Wait for Vite to start
  await sleep(5000);

  console.log("[dev] Building electron main process...");
  const build = spawn("node", ["build.mjs"], {
    stdio: "inherit",
    cwd: new URL("../packages/electron", import.meta.url).pathname,
  });
  processes.push(build);

  await new Promise<void>((resolve, reject) => {
    build.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron build exited with code ${code}`));
    });
  });

  console.log("[dev] Starting Electron...");
  const electronPath = new URL("../packages/electron", import.meta.url).pathname;
  const electron = spawn(
    "npx",
    ["electron", "."],
    {
      stdio: "inherit",
      cwd: electronPath,
      env: { ...process.env, NODE_ENV: "development" },
    }
  );
  processes.push(electron);

  electron.on("close", () => {
    console.log("[dev] Electron closed.");
    cleanup();
  });
}

main().catch((err) => {
  console.error("[dev] Error:", err.message);
  cleanup();
});
