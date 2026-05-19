// ── KYC SERVICE ───────────────────────────────────────────
// FinLync Demo · KYC Verification Service
// Port: 3001
// Run: node kyc-service.js
// ─────────────────────────────────────────────────────────

const http = require("http");
const url  = require("url");

const PORT    = 3001;
const SERVICE = "FinLync KYC Service";
const VERSION = "1.4.2";
const START   = new Date();

// ── REQUEST LOG ───────────────────────────────────────────
const requestLog = [];
let totalRequests = 0, passCount = 0, failCount = 0, timeoutCount = 0;

function logRequest(entry) {
  requestLog.unshift({ ...entry, ts: new Date().toISOString(), id: ++totalRequests });
  if (requestLog.length > 50) requestLog.pop();
  if (entry.result === "VERIFIED")  passCount++;
  if (entry.result === "FAILED")    failCount++;
  if (entry.result === "TIMEOUT")   timeoutCount++;
  console.log(`[${new Date().toLocaleTimeString()}] ${entry.method} ${entry.path} → ${entry.result} (${entry.latency}ms)`);
}

// ── CORS HEADERS ──────────────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── HELPERS ───────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function uptime() {
  const s = Math.floor((Date.now() - START) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

// ── KYC RESPONSE BUILDER ──────────────────────────────────
function buildKYCResponse(mode, applicant) {
  const ref = "KYC-" + Math.floor(Math.random() * 900000 + 100000);
  const name = applicant?.fullName || applicant?.name || "Unknown";

  switch (mode) {
    case "pass":
    default:
      return {
        status: "VERIFIED",
        reference: ref,
        applicant: name,
        score: 0.97,
        confidence: "HIGH",
        checks: {
          nameMatch:        { result: "PASS", score: 0.99, detail: "Full name matched across 3 identity sources" },
          dobVerification:  { result: "PASS", score: 0.98, detail: "Date of birth confirmed via government registry" },
          documentValidity: { result: "PASS", score: 0.96, detail: "Document not expired · no tampering detected · OCR confidence 97%" },
          livenessCheck:    { result: "PASS", score: 0.94, detail: "Biometric liveness confirmed · no spoof detected" },
          addressVerify:    { result: "PASS", score: 0.91, detail: "Address matched to postal registry" },
        },
        provider:   "Jumio Identity Platform",
        riskLevel:  "LOW",
        decision:   "AUTO_APPROVED",
        processedAt: new Date().toISOString(),
        expiresAt:  new Date(Date.now() + 365*24*60*60*1000).toISOString(),
        message:    "Identity verification successful. All checks passed.",
      };

    case "fail":
      return {
        status: "FAILED",
        reference: ref,
        applicant: name,
        score: 0.31,
        confidence: "LOW",
        checks: {
          nameMatch:        { result: "PASS",    score: 0.72, detail: "Partial name match — possible alias or transliteration" },
          dobVerification:  { result: "FAIL",    score: 0.18, detail: "Date of birth mismatch against government registry" },
          documentValidity: { result: "FAIL",    score: 0.24, detail: "Document shows signs of alteration in MRZ zone" },
          livenessCheck:    { result: "PASS",    score: 0.88, detail: "Liveness confirmed" },
          addressVerify:    { result: "WARNING", score: 0.55, detail: "Address partially matched — unit number discrepancy" },
        },
        provider:   "Jumio Identity Platform",
        riskLevel:  "HIGH",
        decision:   "REJECTED",
        failureCode: "IDENTITY_MISMATCH",
        processedAt: new Date().toISOString(),
        message:    "Identity verification failed. DOB mismatch and document integrity issues detected.",
      };

    case "pending":
      return {
        status: "PENDING",
        reference: ref,
        applicant: name,
        score: null,
        confidence: "INCONCLUSIVE",
        checks: {
          nameMatch:        { result: "PASS",    score: 0.81, detail: "Name matched" },
          dobVerification:  { result: "PENDING", score: null, detail: "Awaiting government registry response" },
          documentValidity: { result: "PENDING", score: null, detail: "Manual review required for non-standard document format" },
          livenessCheck:    { result: "PASS",    score: 0.92, detail: "Liveness confirmed" },
          addressVerify:    { result: "PENDING", score: null, detail: "Address verification queue: estimated 2 minutes" },
        },
        provider:    "Jumio Identity Platform",
        riskLevel:   "MEDIUM",
        decision:    "MANUAL_REVIEW",
        pollInterval: 5000,
        pollUrl:     `http://localhost:${PORT}/status/${ref}`,
        processedAt: new Date().toISOString(),
        message:     "Verification inconclusive. Manual review required. Poll status endpoint for updates.",
      };

    case "timeout":
      return null; // handled by sleep

    case "rfi":
      return {
        status: "RFI_REQUIRED",
        reference: ref,
        applicant: name,
        score: 0.52,
        confidence: "LOW",
        checks: {
          nameMatch:        { result: "PASS",    score: 0.88, detail: "Name matched" },
          dobVerification:  { result: "PASS",    score: 0.91, detail: "DOB confirmed" },
          documentValidity: { result: "FAIL",    score: 0.12, detail: "Document expired 14 Mar 2024" },
          livenessCheck:    { result: "PASS",    score: 0.94, detail: "Liveness confirmed" },
          addressVerify:    { result: "PASS",    score: 0.78, detail: "Address matched" },
        },
        provider:    "Jumio Identity Platform",
        riskLevel:   "MEDIUM",
        decision:    "RFI_REQUIRED",
        rfiReasons:  ["DOCUMENT_EXPIRED"],
        rfiMessage:  "Primary identity document has expired. Please request updated documentation from applicant.",
        processedAt: new Date().toISOString(),
        message:     "Verification blocked. Identity document expired. RFI required.",
      };
  }
}

// ── DASHBOARD HTML ────────────────────────────────────────
function dashboardHTML() {
  const logRows = requestLog.slice(0, 20).map(r => `
    <tr>
      <td style="color:#64748b;font-family:monospace;font-size:11px">${r.ts.replace("T"," ").slice(0,19)}</td>
      <td><span style="font-family:monospace;font-size:11px;padding:2px 6px;border-radius:3px;background:#1e3a5c;color:#93c5fd">${r.method}</span> ${r.path}</td>
      <td style="font-family:monospace;font-size:11px">${r.applicant || "—"}</td>
      <td style="font-family:monospace;font-size:11px">${r.mode || "—"}</td>
      <td>
        <span style="font-size:11px;padding:2px 8px;border-radius:3px;font-family:monospace;font-weight:600;
          background:${r.result==="VERIFIED"?"#064e3b":r.result==="FAILED"?"#7f1d1d":r.result==="TIMEOUT"?"#78350f":"#1e3a5c"};
          color:${r.result==="VERIFIED"?"#6ee7b7":r.result==="FAILED"?"#fca5a5":r.result==="TIMEOUT"?"#fde68a":"#93c5fd"}">
          ${r.result}
        </span>
      </td>
      <td style="font-family:monospace;font-size:11px;color:${r.latency>2000?"#f87171":r.latency>800?"#fbbf24":"#6ee7b7"}">${r.latency}ms</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html>
<head>
  <title>FinLync KYC Service</title>
  <meta charset="utf-8"/>
  <meta http-equiv="refresh" content="5"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
    .header{background:linear-gradient(135deg,#1e3a5c,#0f2a45);padding:24px 32px;border-bottom:1px solid #1e293b}
    .badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-family:monospace;padding:3px 10px;border-radius:12px;background:#064e3b;color:#6ee7b7;border:1px solid #065f46}
    .dot{width:7px;height:7px;border-radius:50%;background:#34d399;animation:pulse 1.5s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    .title{font-size:22px;font-weight:700;color:#f8fafc;letter-spacing:-0.5px;margin:8px 0 4px}
    .sub{font-size:13px;color:#64748b}
    .body{padding:28px 32px}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}
    .card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px 18px}
    .card-label{font-size:10px;font-family:monospace;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}
    .card-value{font-size:24px;font-weight:700;font-family:monospace;letter-spacing:-0.5px}
    .section-title{font-size:11px;font-family:monospace;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}
    .table-wrap{background:#1e293b;border:1px solid #334155;border-radius:10px;overflow:hidden;margin-bottom:28px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{padding:9px 14px;text-align:left;font-size:9px;font-family:monospace;color:#64748b;letter-spacing:0.5px;text-transform:uppercase;border-bottom:1px solid #334155;background:#0f172a}
    td{padding:9px 14px;border-bottom:1px solid #1e293b;color:#cbd5e1}
    tr:last-child td{border-bottom:none}
    .endpoint-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:28px}
    .endpoint{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px 18px}
    .ep-method{font-family:monospace;font-size:11px;padding:2px 7px;border-radius:3px;margin-right:6px;font-weight:600}
    .get{background:#1e3a5c;color:#93c5fd}
    .post{background:#1c3a2e;color:#6ee7b7}
    .ep-path{font-family:monospace;font-size:13px;color:#f8fafc}
    .ep-desc{font-size:12px;color:#64748b;margin-top:6px}
    .ep-params{margin-top:8px;font-size:11px;color:#475569;font-family:monospace}
    .mode-pill{display:inline-block;padding:1px 6px;border-radius:3px;background:#1e293b;border:1px solid #334155;margin:1px;font-size:10px}
  </style>
</head>
<body>
<div class="header">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <div>
      <div class="badge"><div class="dot"></div> ONLINE</div>
      <div class="title">FinLync KYC Service</div>
      <div class="sub">Identity Verification · v${VERSION} · Port ${PORT} · Uptime ${uptime()}</div>
    </div>
    <div style="text-align:right;font-family:monospace;font-size:12px;color:#64748b">
      <div>Auto-refreshes every 5s</div>
      <div style="margin-top:4px;color:#475569">${new Date().toLocaleTimeString()}</div>
    </div>
  </div>
</div>

<div class="body">
  <div class="grid">
    <div class="card">
      <div class="card-label">Total requests</div>
      <div class="card-value" style="color:#93c5fd">${totalRequests}</div>
    </div>
    <div class="card">
      <div class="card-label">Verified</div>
      <div class="card-value" style="color:#6ee7b7">${passCount}</div>
    </div>
    <div class="card">
      <div class="card-label">Failed / RFI</div>
      <div class="card-value" style="color:#f87171">${failCount}</div>
    </div>
    <div class="card">
      <div class="card-label">Timeouts</div>
      <div class="card-value" style="color:#fbbf24">${timeoutCount}</div>
    </div>
  </div>

  <div class="section-title">Available endpoints</div>
  <div class="endpoint-grid">
    <div class="endpoint">
      <div><span class="ep-method get">GET</span><span class="ep-path">/health</span></div>
      <div class="ep-desc">Service health check · returns status and uptime</div>
    </div>
    <div class="endpoint">
      <div><span class="ep-method post">POST</span><span class="ep-path">/verify</span></div>
      <div class="ep-desc">Submit KYC verification request</div>
      <div class="ep-params">?mode= 
        <span class="mode-pill">pass</span>
        <span class="mode-pill">fail</span>
        <span class="mode-pill">pending</span>
        <span class="mode-pill">timeout</span>
        <span class="mode-pill">rfi</span>
      </div>
    </div>
    <div class="endpoint">
      <div><span class="ep-method get">GET</span><span class="ep-path">/status/:ref</span></div>
      <div class="ep-desc">Poll verification status by reference ID</div>
    </div>
    <div class="endpoint">
      <div><span class="ep-method get">GET</span><span class="ep-path">/providers</span></div>
      <div class="ep-desc">List connected identity verification providers</div>
    </div>
  </div>

  <div class="section-title">Recent requests</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Endpoint</th>
          <th>Applicant</th>
          <th>Mode</th>
          <th>Result</th>
          <th>Latency</th>
        </tr>
      </thead>
      <tbody>
        ${logRows || `<tr><td colspan="6" style="text-align:center;padding:24px;color:#475569">No requests yet — waiting for connections from FinLync frontend</td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="section-title">Service configuration</div>
  <div class="table-wrap">
    <table>
      ${[
        ["Provider","Jumio Identity Platform"],
        ["API Version","v4.0.0"],
        ["Supported documents","Passport · National ID · Driver's Licence · Residence Permit"],
        ["Supported countries","180+ countries"],
        ["Base latency","600–900ms"],
        ["Timeout threshold","3000ms"],
        ["Max retries","3"],
        ["CORS origin","http://localhost:5173 (FinLync Frontend)"],
      ].map(([k,v]) => `<tr><td style="color:#64748b;width:220px">${k}</td><td style="font-family:monospace;font-size:12px">${v}</td></tr>`).join("")}
    </table>
  </div>
</div>
</body>
</html>`;
}

// ── REQUEST HANDLER ───────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query    = parsed.query;
  const t0       = Date.now();

  setCORS(res);

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204); res.end(); return;
  }

  // Dashboard
  if (req.method === "GET" && pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(dashboardHTML()); return;
  }

  // Health
  if (req.method === "GET" && pathname === "/health") {
    const lat = Date.now() - t0;
    logRequest({ method:"GET", path:"/health", applicant:"—", mode:"—", result:"ONLINE", latency:lat });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      service: SERVICE, version: VERSION, status: "ONLINE",
      uptime: uptime(), port: PORT,
      providers: [{ name:"Jumio Identity Platform", status:"CONNECTED", latency: Math.floor(Math.random()*30+20)+"ms" }],
      timestamp: new Date().toISOString(),
    })); return;
  }

  // Providers
  if (req.method === "GET" && pathname === "/providers") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ providers: [
      { id:"jumio",  name:"Jumio Identity Platform",  status:"CONNECTED", tier:"primary",  latency:"~820ms", supportedModes:["pass","fail","pending","rfi","timeout"] },
      { id:"onfido", name:"Onfido Smart Capture",     status:"STANDBY",   tier:"failover", latency:"~950ms", supportedModes:["pass","fail"] },
    ]})); return;
  }

  // Status poll
  if (req.method === "GET" && pathname.startsWith("/status/")) {
    const ref = pathname.split("/status/")[1];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      reference: ref, status:"VERIFIED", score:0.91, decision:"AUTO_APPROVED",
      message:"Verification complete after manual review.",
      updatedAt: new Date().toISOString(),
    })); return;
  }

  // Verify (main endpoint)
  if (req.method === "POST" && pathname === "/verify") {
    const body = await readBody(req);
    const mode = query.mode || "pass";

    // Timeout simulation
    if (mode === "timeout") {
      await sleep(3500);
      const lat = Date.now() - t0;
      logRequest({ method:"POST", path:"/verify", applicant:body?.fullName||"Unknown", mode, result:"TIMEOUT", latency:lat });
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status:"TIMEOUT", error:"Gateway timeout after 3500ms", reference:null, message:"KYC provider did not respond within timeout threshold." }));
      return;
    }

    // Realistic latency per mode
    const latencyMap = { pass:820, fail:640, pending:480, rfi:560 };
    await sleep((latencyMap[mode] || 700) + Math.floor(Math.random()*120));

    const response = buildKYCResponse(mode, body);
    const lat = Date.now() - t0;
    logRequest({ method:"POST", path:"/verify", applicant:body?.fullName||"Unknown", mode, result:response.status, latency:lat });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...response, serviceLatency: lat, processedBy: SERVICE }));
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error:"Not found", path:pathname }));
});

server.listen(PORT, () => {
  console.log("─".repeat(50));
  console.log(`  FinLync KYC Service`);
  console.log(`  Version : ${VERSION}`);
  console.log(`  Port    : ${PORT}`);
  console.log(`  Dashboard : http://localhost:${PORT}`);
  console.log(`  Health    : http://localhost:${PORT}/health`);
  console.log(`  Verify    : POST http://localhost:${PORT}/verify?mode=pass`);
  console.log("─".repeat(50));
});
