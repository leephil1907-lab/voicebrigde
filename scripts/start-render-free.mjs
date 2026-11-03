import { spawn } from "node:child_process";

const required = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY", "ELEVENLABS_API_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`VoiceBridge deployment is missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const children = [
  spawn(process.execPath, ["apps/api/dist/server.js"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, ["apps/api/dist/dubbing-worker.js"], { stdio: "inherit", env: process.env }),
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  const forceExit = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    process.exit(code);
  }, 10_000);
  forceExit.unref();
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => shutdown(0));
for (const child of children) {
  child.once("error", (error) => {
    console.error("VoiceBridge process failed to start", error);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`VoiceBridge process exited unexpectedly (code=${code}, signal=${signal}). Stopping the service.`);
      shutdown(code ?? 1);
    }
  });
}
console.info("VoiceBridge API and durable worker started in the same Render web service.");
