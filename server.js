const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const app = express();
const execFileAsync = promisify(execFile);
const PORT = process.env.PORT || 3000;
const BUILD_ROOT = process.env.BUILD_ROOT || path.join(os.tmpdir(), "fwapk-builds");

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

function safePackageName(value) {
  const v = String(value || "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*){1,}$/.test(v)) {
    throw new Error("Package name must look like com.example.myapp");
  }
  return v;
}
function safeAppName(value) {
  const v = String(value || "My Website").trim().replace(/[<>"]/g, "").slice(0, 40);
  if (!v) throw new Error("Enter an app name.");
  return v;
}
function run(command, args, cwd, timeout = 12 * 60 * 1000) {
  return execFileAsync(command, args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024, env: process.env });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    builderReady: process.env.ANDROID_BUILDER_READY === "true",
    message: "API online. Configure Java, Android SDK and Gradle on this server to build APKs."
  });
});

app.post("/api/build", async (req, res) => {
  let workDir;
  try {
    if (process.env.ANDROID_BUILDER_READY !== "true") {
      return res.status(503).json({
        error: "APK build server is not configured yet. Deploy this project on a server with Java, Android SDK and Gradle, then set ANDROID_BUILDER_READY=true."
      });
    }

    const html = String(req.body.html || "");
    if (!html.trim()) return res.status(400).json({ error: "Paste your HTML code first." });
    if (Buffer.byteLength(html, "utf8") > 2 * 1024 * 1024) {
      return res.status(413).json({ error: "HTML is too large. Maximum size is 2 MB." });
    }

    const appName = safeAppName(req.body.appName);
    const appId = safePackageName(req.body.packageName);
    const version = String(req.body.version || "1.0.0").trim().slice(0, 20);
    const jobId = crypto.randomBytes(8).toString("hex");
    workDir = path.join(BUILD_ROOT, jobId);
    fs.mkdirSync(workDir, { recursive: true });

    const projectDir = path.join(workDir, "project");
    await run("npx", ["--yes", "@capacitor/cli", "create", appName, "--app-id", appId, "--web-dir", "www"], workDir);
    fs.mkdirSync(path.join(projectDir, "www"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "www", "index.html"), html);
    fs.writeFileSync(path.join(projectDir, "capacitor.config.json"), JSON.stringify({
      appId, appName, webDir: "www", bundledWebRuntime: false
    }, null, 2));

    await run("npx", ["cap", "add", "android"], projectDir);
    await run("npx", ["cap", "sync", "android"], projectDir);
    const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
    await run(gradle, ["assembleDebug"], path.join(projectDir, "android"), 12 * 60 * 1000);

    const apk = path.join(projectDir, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
    if (!fs.existsSync(apk)) throw new Error("Build finished but APK file was not found.");
    res.download(apk, `${appName.replace(/[^a-z0-9-_]/gi, "_")}-${version}-debug.apk`, () => {
      fs.rmSync(workDir, { recursive: true, force: true });
    });
  } catch (err) {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    res.status(500).json({ error: (err.stderr || err.message || "Build failed").toString().slice(0, 1800) });
  }
});

app.listen(PORT, () => console.log(`FreeWebsiteToApk running on port ${PORT}`));
