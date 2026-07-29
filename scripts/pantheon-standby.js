const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] || process.env.PORT || 5050);
const workingPort = Number(process.env.PANTHEON_WORKING_PORT || 5051);
const instanceId = String(process.env.PANTHEON_RUNTIME_INSTANCE_ID || randomBytes(16).toString("hex"));
const bootstrapSecret = String(process.env.PANTHEON_OPERATOR_BOOTSTRAP || "");
const controlToken = String(process.env.PANTHEON_CONTROL_TOKEN || "");
const metadataPath = String(process.env.PANTHEON_RUNTIME_METADATA_PATH || "");
const useIsolatedWorkingRuntime = process.env.PANTHEON_CONTROL_JOURNEY_REHEARSAL === "1";
// start-pantheon.ps1 has bounded launcher-lock, reachability, readiness, and
// cleanup phases, plus local credential and source-integrity preflight. Give a
// cold start material headroom while retaining one finite outer deadline.
const workingStartTimeoutMs = 150_000;
const powerShellTerminationTimeoutMs = 8_000;
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const sessions = new Map();
const pageNonce = randomBytes(24).toString("base64");
let stopping = false;
let transition = null;

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(body);
}

function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function requestHostAllowed(req) {
  const host = String(req.headers.host || "").toLowerCase();
  return /^(127\.0\.0\.1|localhost):\d+$/.test(host);
}

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return separator < 0
          ? [entry, ""]
          : [entry.slice(0, separator), decodeURIComponent(entry.slice(separator + 1))];
      }),
  );
}

function sessionFor(req) {
  const id = cookies(req).pantheon_standby_session;
  const session = id ? sessions.get(id) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (id) sessions.delete(id);
    return null;
  }
  return session;
}

function assertMutation(req) {
  const session = sessionFor(req);
  if (!session) throw new Error("Pantheon Control needs a local operator session.");
  const origin = String(req.headers.origin || "");
  if (origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    throw new Error("Pantheon Control rejected a cross-origin command.");
  }
  if (!equalSecret(req.headers["x-pantheon-csrf"], session.csrfToken)) {
    throw new Error("Pantheon Control rejected an invalid request token.");
  }
  return session;
}

function readBody(req, limit = 16_384) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function workingHealth() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port: workingPort,
        path: "/api/health",
        timeout: 1_500,
        headers: { host: `127.0.0.1:${workingPort}` },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve(response.statusCode === 200 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

function runPowerShell(scriptName, args = [], extraEnvironment = {}, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, scriptName),
        ...args,
      ],
      {
        cwd: root,
        windowsHide: true,
        env: {
          ...process.env,
          ...extraEnvironment,
        },
      },
    );
    const stdout = [];
    const stderr = [];
    let settled = false;
    let deadline = null;
    let timeoutError = null;
    const finish = (error, code = null) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();
      child.stdout.destroy();
      child.stderr.destroy();
      if (timeoutError) {
        timeoutError.message += (
          ` Captured ${Buffer.byteLength(out)} stdout bytes and `
          + `${Buffer.byteLength(err)} stderr bytes; their content was withheld.`
        );
        reject(timeoutError);
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      if (code === 0) {
        resolve({ stdout: out, stderr: err });
        return;
      }
      reject(new Error(err || out || `Pantheon command exited with code ${code}.`));
    };
    const retainOutput = (target, chunk) => {
      if (target.reduce((total, item) => total + item.length, 0) < 1024 * 1024) {
        target.push(chunk);
      }
    };
    child.stdout.on("data", (chunk) => retainOutput(stdout, chunk));
    child.stderr.on("data", (chunk) => retainOutput(stderr, chunk));
    child.on("error", (error) => finish(error));
    // A working Node process can inherit PowerShell's output handles. The
    // PowerShell exit is authoritative; waiting for inherited pipes can hang.
    child.on("exit", (code) => finish(null, code));
    deadline = setTimeout(() => {
      timeoutError = new Error(
        `Pantheon stopped waiting because ${scriptName} exceeded its ${Math.round(timeoutMs / 1000)}-second deadline.`,
      );
      if (process.platform !== "win32" || !child.pid) {
        child.kill("SIGKILL");
        finish(timeoutError);
        return;
      }
      const killer = spawn(
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      const killerDeadline = setTimeout(() => {
        killer.kill("SIGKILL");
        child.kill("SIGKILL");
        finish(timeoutError);
      }, powerShellTerminationTimeoutMs);
      killerDeadline.unref();
      const killed = () => {
        clearTimeout(killerDeadline);
        child.kill("SIGKILL");
        finish(timeoutError);
      };
      killer.once("error", killed);
      killer.once("exit", killed);
    }, timeoutMs);
    deadline.unref();
  });
}

async function startWorking() {
  if (transition) return transition;
  transition = (async () => {
    const handoffPath = path.join(root, "tmp", `pantheon-operator-url-${process.pid}-${Date.now()}.txt`);
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    try {
      const startArguments = [
        "-Port",
        String(workingPort),
        "-NoOpen",
        "-OperatorUrlFile",
        handoffPath,
        ...(useIsolatedWorkingRuntime ? ["-JourneyRehearsal"] : []),
      ];
      await runPowerShell(
        "start-pantheon.ps1",
        startArguments,
        {
          PANTHEON_STANDBY_URL: `http://127.0.0.1:${port}`,
          PANTHEON_STANDBY_HANDOFF_TOKEN: controlToken,
        },
        workingStartTimeoutMs,
      );
      const operatorUrl = fs.readFileSync(handoffPath, "utf8").trim();
      if (!operatorUrl.startsWith(`http://127.0.0.1:${workingPort}/`)) {
        throw new Error("Pantheon started but did not provide a valid local operator URL.");
      }
      return operatorUrl;
    } finally {
      fs.rmSync(handoffPath, { force: true });
      transition = null;
    }
  })();
  return transition;
}

function scheduleReturnToStandby() {
  if (transition) return false;
  transition = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      await runPowerShell(
        "stop-pantheon.ps1",
        ["-Port", String(workingPort)],
        {},
        30_000,
      );
    } finally {
      transition = null;
    }
  })();
  transition.catch((error) => {
    process.stderr.write(`${new Date().toISOString()} ${error.stack || error.message}\n`);
  });
  return true;
}

function stopControlShell(options = {}) {
  if (stopping) return;
  stopping = true;
  setTimeout(() => {
    server.close(() => {
      if (metadataPath && options.removeMetadata !== false) {
        fs.rmSync(metadataPath, { force: true });
      }
      process.exit(0);
    });
  }, 400);
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pantheon Control</title>
  <style nonce="${pageNonce}">
    :root { color-scheme: dark; font-family: Inter, "Segoe UI", sans-serif; background:#0a0d12; color:#f4f6f8; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:#0a0d12; }
    .shell { min-height:100vh; display:grid; grid-template-columns:220px 1fr; }
    aside { border-right:1px solid #202631; padding:28px 22px; background:#0d1118; }
    .brand { font-size:18px; font-weight:700; letter-spacing:0; }
    .sub { margin-top:6px; color:#8993a3; font-size:12px; }
    .state { margin-top:34px; padding:12px; border:1px solid #26303d; border-radius:7px; background:#111720; }
    .state strong { display:block; color:#9fe0bc; font-size:13px; }
    .state span { display:block; color:#8d97a6; font-size:12px; margin-top:4px; line-height:1.5; }
    main { padding:42px 52px; max-width:1180px; width:100%; }
    header { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; }
    h1 { font-size:28px; margin:0; font-weight:650; letter-spacing:0; }
    p { color:#98a2b1; line-height:1.65; max-width:650px; }
    .badge { border:1px solid #2b3542; background:#121821; color:#b9c3cf; padding:8px 11px; border-radius:6px; font-size:12px; }
    .panel { margin-top:34px; border:1px solid #242d38; background:#10151d; border-radius:8px; padding:28px; }
    .panel h2 { margin:0 0 8px; font-size:17px; letter-spacing:0; }
    .facts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1px; background:#222b36; border:1px solid #222b36; margin:24px 0; }
    .fact { background:#0f141c; padding:18px; min-height:92px; }
    .fact span { display:block; color:#7f8a99; font-size:11px; text-transform:uppercase; }
    .fact strong { display:block; margin-top:10px; font-size:15px; font-weight:600; }
    .actions { display:flex; gap:10px; flex-wrap:wrap; }
    button { border:1px solid #303b49; border-radius:6px; padding:11px 15px; color:#eaf0f4; background:#17202b; font:inherit; font-size:13px; cursor:pointer; }
    button.primary { background:#dcefe4; color:#101710; border-color:#dcefe4; font-weight:650; }
    button.danger { color:#ffb5b5; border-color:#543034; background:#211519; margin-left:auto; }
    button:disabled { opacity:.45; cursor:wait; }
    #message { min-height:24px; margin-top:18px; color:#aeb8c4; font-size:13px; }
    @media (max-width:760px) { .shell{grid-template-columns:1fr} aside{display:none} main{padding:28px 20px}.facts{grid-template-columns:1fr}.actions{display:grid}button.danger{margin-left:0} }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="brand">Pantheon</div>
      <div class="sub">Commercial operating system</div>
      <div class="state"><strong>Standby</strong><span>The control shell is available. Business workers and scheduled work are not loaded.</span></div>
    </aside>
    <main>
      <header>
        <div><h1>Pantheon Control</h1><p>Start the business runtime when you want Pantheon working. Return here when you want the dashboard available without the heavy worker system running.</p></div>
        <div class="badge" id="mode-badge">Checking status</div>
      </header>
      <section class="panel">
        <h2 id="status-title">Pantheon is in standby</h2>
        <p id="status-copy">No AI workers, scheduler, or business automation is active.</p>
        <div class="facts">
          <div class="fact"><span>Control shell</span><strong id="shell-state">Available</strong></div>
          <div class="fact"><span>Business runtime</span><strong id="runtime-state">Stopped</strong></div>
          <div class="fact"><span>Control memory</span><strong id="memory-state">Checking</strong></div>
        </div>
        <div class="actions">
          <button class="primary" id="start-button">Start working</button>
          <button id="refresh-button">Refresh status</button>
          <button class="danger" id="stop-button">Stop Pantheon</button>
        </div>
        <div id="message" role="status"></div>
      </section>
    </main>
  </div>
  <script nonce="${pageNonce}">
    let csrfToken = "";
    const message = document.getElementById("message");
    async function establishSession() {
      let response = await fetch("/api/session", { credentials:"same-origin" });
      if (response.ok) {
        const data = await response.json();
        csrfToken = data.csrfToken;
        return;
      }
      const hash = new URLSearchParams(location.hash.slice(1));
      const bootstrap = hash.get("bootstrap") || "";
      response = await fetch("/api/session", {
        method:"POST",
        headers:{"content-type":"application/json"},
        credentials:"same-origin",
        body:JSON.stringify({ bootstrap }),
      });
      if (!response.ok) throw new Error("Pantheon Control could not establish its local session. Reopen START PANTHEON.cmd.");
      const data = await response.json();
      csrfToken = data.csrfToken;
      history.replaceState(null, "", location.pathname);
    }
    async function status() {
      const response = await fetch("/api/control/status", { credentials:"same-origin" });
      if (!response.ok) throw new Error("Pantheon status is unavailable.");
      const data = await response.json();
      const working = Boolean(data.working);
      document.getElementById("mode-badge").textContent = working ? "Working" : "Standby";
      document.getElementById("runtime-state").textContent = working ? "Working" : "Stopped";
      document.getElementById("memory-state").textContent = data.memoryMb + " MB";
      document.getElementById("status-title").textContent = working ? "Pantheon is working" : "Pantheon is in standby";
      document.getElementById("status-copy").textContent = working
        ? "The business runtime, monitoring, and approved AI capabilities are available."
        : "No AI workers, scheduler, or business automation is active.";
      document.getElementById("start-button").textContent = working ? "Open Pantheon" : "Start working";
      return data;
    }
    async function mutate(path) {
      const response = await fetch(path, {
        method:"POST",
        credentials:"same-origin",
        headers:{"content-type":"application/json","x-pantheon-csrf":csrfToken},
        body:"{}",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Pantheon could not complete that control action.");
      return data;
    }
    async function busy(button, action) {
      const buttons = [...document.querySelectorAll("button")];
      buttons.forEach((item) => { item.disabled = true; });
      try { await action(); } finally { buttons.forEach((item) => { item.disabled = false; }); }
    }
    document.getElementById("start-button").addEventListener("click", (event) => busy(event.currentTarget, async () => {
      message.textContent = "Starting Pantheon's business runtime...";
      const result = await mutate("/api/control/start");
      location.href = result.operatorUrl;
    }).catch((error) => { message.textContent = error.message; }));
    document.getElementById("refresh-button").addEventListener("click", (event) => busy(event.currentTarget, async () => {
      message.textContent = "";
      await status();
    }).catch((error) => { message.textContent = error.message; }));
    document.getElementById("stop-button").addEventListener("click", (event) => busy(event.currentTarget, async () => {
      message.textContent = "Stopping Pantheon...";
      await mutate("/api/control/stop");
      document.getElementById("status-title").textContent = "Pantheon has stopped";
      document.getElementById("status-copy").textContent = "No Pantheon processes remain. Run START PANTHEON.cmd when you need it again.";
      document.querySelector(".actions").remove();
      message.textContent = "";
    }).catch((error) => { message.textContent = error.message; }));
    establishSession().then(status).catch((error) => { message.textContent = error.message; });
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader(
    "content-security-policy",
    `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self'; style-src 'nonce-${pageNonce}'; script-src 'nonce-${pageNonce}'; connect-src 'self'`,
  );
  if (!requestHostAllowed(req)) {
    json(res, 403, { error: "Pantheon Control accepts only local requests." });
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === "GET" && url.pathname === "/") {
    text(res, 200, page, "text/html; charset=utf-8");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    const health = await workingHealth();
    json(res, 200, {
      alive: true,
      ok: true,
      installationReady: null,
      recoveryReady: null,
      runtimeReady: false,
      readinessScope: "standby_control_shell",
      operationsReady: false,
      operationsReadyAliasFor: "runtimeReady",
      mode: "standby",
      instanceId,
      working: Boolean(health?.alive),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      time: new Date().toISOString(),
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/runtime/shutdown") {
    if (!equalSecret(req.headers["x-pantheon-control"], controlToken)) {
      json(res, 403, { error: "Runtime control token rejected." });
      return;
    }
    json(res, 202, { ok: true, instanceId });
    stopControlShell({ removeMetadata: false });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/session") {
    try {
      const body = await readBody(req);
      if (!equalSecret(body.bootstrap, bootstrapSecret)) throw new Error("Pantheon Control rejected the startup token.");
      const id = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
      sessions.set(id, { csrfToken, expiresAt });
      json(res, 201, { ok: true, csrfToken, expiresAt }, {
        "set-cookie": `pantheon_standby_session=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
      });
    } catch (error) {
      json(res, 401, { error: error.message });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/session") {
    const session = sessionFor(req);
    if (!session) {
      json(res, 401, { error: "No local operator session is active." });
      return;
    }
    json(res, 200, { ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/control/return-to-standby") {
    if (!equalSecret(req.headers["x-pantheon-standby"], controlToken)) {
      json(res, 403, { error: "Pantheon Control rejected the runtime handoff." });
      return;
    }
    const scheduled = scheduleReturnToStandby();
    json(res, scheduled ? 202 : 409, {
      ok: scheduled,
      controlUrl: `http://127.0.0.1:${port}/`,
      error: scheduled ? undefined : "Pantheon is already changing operating mode.",
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/control/stop-all") {
    if (!equalSecret(req.headers["x-pantheon-standby"], controlToken)) {
      json(res, 403, { error: "Pantheon Control rejected the runtime handoff." });
      return;
    }
    json(res, 202, { ok: true });
    setTimeout(async () => {
      try {
        await runPowerShell("stop-pantheon.ps1", ["-Port", String(workingPort)]);
      } catch (error) {
        process.stderr.write(`${new Date().toISOString()} ${error.stack || error.message}\n`);
      } finally {
        stopControlShell();
      }
    }, 250);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/control/status") {
    if (!sessionFor(req)) {
      json(res, 401, { error: "No local operator session is active." });
      return;
    }
    const health = await workingHealth();
    json(res, 200, {
      mode: health?.alive ? "working" : "standby",
      working: Boolean(health?.alive),
      workingReady: Boolean(health?.runtimeReady),
      workingUrl: `http://127.0.0.1:${workingPort}/`,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      transition: Boolean(transition),
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/control/start") {
    try {
      assertMutation(req);
      const operatorUrl = await startWorking();
      json(res, 200, { ok: true, operatorUrl });
    } catch (error) {
      json(res, 409, { error: error.message });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/control/stop") {
    try {
      assertMutation(req);
      json(res, 202, { ok: true });
      setTimeout(async () => {
        try {
          const health = await workingHealth();
          if (health?.alive) await runPowerShell("stop-pantheon.ps1", ["-Port", String(workingPort)]);
        } catch (error) {
          process.stderr.write(`${new Date().toISOString()} ${error.stack || error.message}\n`);
        } finally {
          stopControlShell();
        }
      }, 250);
    } catch (error) {
      json(res, 403, { error: error.message });
    }
    return;
  }
  json(res, 404, { error: "Not found." });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Pantheon standby control available at http://127.0.0.1:${port}/\n`);
});

process.on("SIGINT", stopControlShell);
process.on("SIGTERM", stopControlShell);
