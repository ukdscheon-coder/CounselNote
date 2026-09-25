"use strict";

const $ = (id) => document.getElementById(id);
const DB_NAME = "school-counselling-v2";
const STORE = "vault";
const META_SALT = "scr-salt-v2";
const META_CHECK = "scr-check-v2";
const AUTO_LOCK_MS = 10 * 60 * 1000;

let db;
let cryptoKey;
let pupils = [];
let sessions = [];
let assessments = [];
let settings = {};
let activeView = "dashboard";
let selectedSessionId = "";
let pendingDelete = null;
let lockTimer;

const sessionTextFields = [
  "sessionId", "sessionPupil", "sessionDate", "startTime", "duration", "sessionNumber",
  "counsellor", "modality", "location", "attendance", "consentNote", "presentingIssue",
  "sessionSummary", "interventionResponse", "childVoice", "observations", "protectiveFactors",
  "educationImpact", "riskLevel", "riskEvidence", "safetyAction", "disclosure",
  "decisionRationale", "safeguardingReference", "nextPlan", "referralFollowup",
  "actionOwner", "followupDate", "actionStatus", "actionOutcome", "supervision", "sessionTags"
];
const sessionChecks = ["recordConsent", "confidentialityDiscussed", "accessRightsExplained", "safeguardingRecorded", "signedOff"];

function bytesToB64(bytes) {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
function b64ToBytes(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptObject(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
  return { iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(encrypted)) };
}
async function decryptObject(payload) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(payload.iv) },
    cryptoKey,
    b64ToBytes(payload.data)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function dbRequest(mode, operation) {
  return new Promise((resolve, reject) => {
    const request = operation(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveCollection(key, value) {
  const payload = await encryptObject(value);
  await dbRequest("readwrite", (store) => store.put({ key, payload }));
  setStatus("Saved locally");
}
async function readCollection(key, fallback) {
  const row = await dbRequest("readonly", (store) => store.get(key));
  if (!row) return fallback;
  return decryptObject(row.payload);
}
async function unlock() {
  const passphrase = $("passphrase").value;
  $("lockError").textContent = "";
  if (passphrase.length < 10) {
    $("lockError").textContent = "Use a passphrase of at least 10 characters.";
    return;
  }
  try {
    let salt = localStorage.getItem(META_SALT);
    if (!salt) {
      salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
      localStorage.setItem(META_SALT, salt);
    }
    cryptoKey = await deriveKey(passphrase, b64ToBytes(salt));
    const check = localStorage.getItem(META_CHECK);
    if (check) {
      vaultCreatedAt = (await decryptObject(JSON.parse(check))).createdAt;
    } else {
      vaultCreatedAt = new Date().toISOString();
      localStorage.setItem(META_CHECK, JSON.stringify(await encryptObject({ valid: true, createdAt: vaultCreatedAt })));
    }
    db = await openDb();
    [pupils, sessions, assessments, settings] = await Promise.all([
      readCollection("pupils", []),
      readCollection("sessions", []),
      readCollection("assessments", []),
      readCollection("settings", {})
    ]);
    $("passphrase").value = "";
    $("lockScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    refreshAll();
    resetAutoLock();
  } catch {
    cryptoKey = null;
    $("lockError").textContent = "The passphrase is incorrect or this vault cannot be opened.";
  }
}

const TRIAL_DAYS = 60;
let vaultCreatedAt = null;

function hasValidLicenceKey() {
  return /^CN-(PR|PF|SA)-[A-Z2-7]+-[0-9A-F]{8}$/.test((settings?.licenseKey || "").trim().toUpperCase());
}
function trialDaysRemaining() {
  if (!vaultCreatedAt) return TRIAL_DAYS;
  const elapsed = (Date.now() - new Date(vaultCreatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(TRIAL_DAYS - elapsed));
}
function isTrialExpired() {
  return !hasValidLicenceKey() && trialDaysRemaining() <= 0;
}
function requireActiveLicenceOrTrial() {
  if (!isTrialExpired()) return true;
  toast("Your 30-day evaluation has ended. Add a licence key in Settings & safety to create new pupils or session records. Existing records remain fully accessible.");
  return false;
}
function renderTrialBanner() {
  const el = $("trialBanner");
  if (!el) return;
  if (hasValidLicenceKey()) { el.classList.add("hidden"); return; }
  const days = trialDaysRemaining();
  el.classList.remove("hidden");
  if (days > 7) {
    el.className = "trial-banner";
    el.textContent = `Free evaluation: ${days} days remaining. Existing records are never affected — add a licence key any time in Settings & safety.`;
  } else if (days > 0) {
    el.className = "trial-banner trial-banner--soon";
    el.textContent = `${days} day${days === 1 ? "" : "s"} left in your evaluation. After this, you can still view, print and back up every record you've made — but you won't be able to open a new pupil or session until a licence key is added. Most schools sort this with a quick PO or card payment in a few minutes — see counselnote.uk/checkout.`;
  } else {
    el.className = "trial-banner trial-banner--expired";
    el.textContent = "Your evaluation has ended. You can still view, print, back up and export every existing record in full. Add a licence key in Settings & safety to open new pupils or session records again.";
  }
}
function lockVault() {
  clearTimeout(lockTimer);
  cryptoKey = null;
  pupils = [];
  sessions = [];
  assessments = [];
  settings = {};
  db?.close();
  db = null;
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  $("app").classList.add("hidden");
  $("lockScreen").classList.remove("hidden");
  $("passphrase").focus();
}
function resetAutoLock() {
  if (!cryptoKey) return;
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    lockVault();
    $("lockError").textContent = "The vault locked after 10 minutes of inactivity.";
  }, AUTO_LOCK_MS);
}
function setStatus(message) {
  $("saveStatus").textContent = message;
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}
function formatDate(value) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}
function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function formatUkDateInput(value) {
  if (!value) return "";
  if (/^\d{2}-\d{2}-\d{2}$/.test(value)) return value;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? `${iso[3]}-${iso[2]}-${iso[1].slice(-2)}` : value;
}
function isValidUkDate(value) {
  if (!value) return true;
  const match = value.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, day, month, year] = match.map(Number);
  const date = new Date(2000 + year, month - 1, day);
  return date.getFullYear() === 2000 + year && date.getMonth() === month - 1 && date.getDate() === day;
}
function ukDateToIso(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  return match ? `20${match[3]}-${match[2]}-${match[1]}` : value;
}
function todayUk() {
  return formatUkDateInput(new Date().toISOString().slice(0, 10));
}
function validateUkDateField(id, required = false) {
  const field = $(id);
  const valid = (!required && !field.value) || isValidUkDate(field.value);
  field.setCustomValidity(valid ? "" : "Enter a valid date in DD-MM-YY format, for example 22-06-26.");
  if (!valid) field.reportValidity();
  return valid;
}
function pupilById(id) {
  return pupils.find((pupil) => pupil.id === id);
}
function renderLicenseStatus() {
  const key = ($("settingLicenseKey").value || "").trim().toUpperCase();
  const el = $("licenseStatus");
  if (!key) { el.textContent = "No licence key entered — running as a 30-day evaluation."; return; }
  const match = /^CN-([A-Z]{2})-[A-Z2-7]+-[0-9A-F]{8}$/.exec(key);
  const tierNames = { PR: "Practitioner", PF: "Professional", SA: "School Assurance" };
  if (!match || !tierNames[match[1]]) { el.textContent = "That doesn't look like a CounselNote licence key — check it was copied in full."; return; }
  el.textContent = `${tierNames[match[1]]} licence key recognised. This is recorded locally and is not checked online.`;
}
$("settingLicenseKey")?.addEventListener("input", renderLicenseStatus);
function pupilCode(id) {
  return pupilById(id)?.code || "Unknown pupil";
}
function refreshAll() {
  settings = {
    productName: "CounselNote",
    schoolName: "",
    counsellor: "",
    licenseKey: "",
    dslName: "",
    dslContact: "",
    mash: "",
    camhs: "",
    retention: "",
    ...settings
  };
  $("brandName").textContent = settings.productName;
  renderTrialBanner();
  renderPupilOptions();
  renderDashboard();
  renderPupils();
  renderSessions();
  renderAssessments();
  renderReports();
  fillSettings();
}
function switchView(view) {
  activeView = view;
  const titles = { dashboard: "Overview", pupils: "Pupils", sessions: "Session records", assessments: "Outcome measures", reports: "Reports", settings: "Settings & safety" };
  document.querySelectorAll(".view").forEach((section) => section.classList.add("hidden"));
  $(`${view}View`).classList.remove("hidden");
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("viewTitle").textContent = titles[view];
  $("contextAction").classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function renderDashboard() {
  const now = new Date();
  const termStart = new Date(now.getFullYear(), now.getMonth() - 4, now.getDate());
  $("statPupils").textContent = pupils.filter((p) => p.status === "active").length;
  $("statSessions").textContent = sessions.filter((s) => new Date(s.sessionDate) >= termStart).length;
  $("statFollowups").textContent = sessions.filter((s) => s.actionStatus === "open").length;
  $("statRisks").textContent = sessions.filter((s) => s.riskLevel && s.riskLevel !== "none").length;
  const latest = [...sessions].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate)).slice(0, 6);
  $("recentSessions").innerHTML = latest.length ? latest.map((s) => `
    <button class="timeline-item" data-session="${escapeHtml(s.id)}">
      <span class="timeline-dot ${escapeHtml(s.riskLevel || "none")}"></span>
      <span><strong>${escapeHtml(pupilCode(s.pupilId))}</strong><small>${formatDate(s.sessionDate)} · ${escapeHtml(s.presentingIssue).slice(0, 55)}</small></span>
    </button>`).join("") : empty("No sessions yet", "Add a pupil and create the first session record.");
  const contacts = [
    ["DSL", [settings.dslName, settings.dslContact].filter(Boolean).join(" · ")],
    ["Local authority children’s social care / MASH", settings.mash],
    ["CAMHS / crisis", settings.camhs]
  ];
  $("contactSummary").innerHTML = contacts.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value || "Not configured")}</strong></div>`).join("");
}
function empty(title, body) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div>`;
}
function renderPupilOptions() {
  const active = pupils.filter((p) => p.status !== "closed").sort((a, b) => a.code.localeCompare(b.code));
  const options = active.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.code)}${p.yearGroup ? ` · ${escapeHtml(p.yearGroup)}` : ""}</option>`).join("");
  $("sessionPupil").innerHTML = `<option value="">Select pupil</option>${options}`;
  $("assessmentPupil").innerHTML = `<option value="">Select pupil</option>${options}`;
  $("assessmentPupilFilter").innerHTML = `<option value="">All pupils</option>${options}`;
}
function renderPupils() {
  const term = $("pupilSearch").value.trim().toLowerCase();
  const filtered = pupils.filter((p) => [p.code, p.yearGroup, p.tags, p.context].join(" ").toLowerCase().includes(term));
  $("pupilGrid").innerHTML = filtered.length ? filtered.map((p) => {
    const pupilSessions = sessions.filter((s) => s.pupilId === p.id);
    const last = [...pupilSessions].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))[0];
    return `<article class="pupil-card" data-pupil="${escapeHtml(p.id)}">
      <div class="pupil-card-head"><span class="status-pill ${escapeHtml(p.status)}">${escapeHtml(p.status)}</span><button class="icon-button edit-pupil" aria-label="Edit ${escapeHtml(p.code)}">•••</button></div>
      <h2>${escapeHtml(p.code)}</h2><p>${escapeHtml(p.yearGroup || "Year group not set")}</p>
      <div class="pupil-meta"><span><strong>${pupilSessions.length}</strong> sessions</span><span><strong>${last ? formatDate(last.sessionDate) : "—"}</strong> last seen</span></div>
      <div class="tag-line">${String(p.tags || "").split(",").filter(Boolean).slice(0, 3).map((tag) => `<em>${escapeHtml(tag.trim())}</em>`).join("")}</div>
      <button class="text-button open-timeline">Open chronology →</button>
    </article>`;
  }).join("") : empty("No pupil profiles", "Use pupil codes rather than names wherever possible.");
}
function renderSessions() {
  const term = $("sessionSearch").value.trim().toLowerCase();
  const filter = $("sessionFilter").value;
  const filtered = [...sessions].sort((a, b) => `${b.sessionDate}${b.startTime}`.localeCompare(`${a.sessionDate}${a.startTime}`)).filter((s) => {
    const match = [pupilCode(s.pupilId), s.presentingIssue, s.sessionTags].join(" ").toLowerCase().includes(term);
    return match && (filter === "all" || (filter === "risk" && s.riskLevel !== "none") || (filter === "followup" && s.actionStatus === "open"));
  });
  $("sessionList").innerHTML = filtered.length ? filtered.map((s) => `
    <button class="record-row ${selectedSessionId === s.id ? "active" : ""}" data-session="${escapeHtml(s.id)}">
      <span class="risk-stripe ${escapeHtml(s.riskLevel || "none")}"></span>
      <span><strong>${escapeHtml(pupilCode(s.pupilId))}</strong><small>${formatDate(s.sessionDate)} · ${escapeHtml(s.presentingIssue).slice(0, 62)}</small></span>
      ${s.followupDate ? `<em>${formatDate(s.followupDate)}</em>` : ""}
    </button>`).join("") : empty("No matching sessions", "Create a session or change the search filter.");
  if (selectedSessionId) renderSessionPreview(selectedSessionId);
}
function renderSessionPreview(id) {
  const s = sessions.find((session) => session.id === id);
  if (!s) return;
  const riskLabel = { none: "No current concern", low: "Low", medium: "Medium", high: "High" }[s.riskLevel] || s.riskLevel;
  $("sessionPreview").innerHTML = `
    <div class="preview-head"><div><p class="eyebrow">${escapeHtml(pupilCode(s.pupilId))}</p><h2>${formatDate(s.sessionDate)}</h2><span>${escapeHtml(s.duration)} minutes · ${escapeHtml(s.modality)}</span></div><span class="risk-badge ${escapeHtml(s.riskLevel)}">${escapeHtml(riskLabel)}</span></div>
    <section><h3>Session aim</h3><p>${escapeHtml(s.presentingIssue)}</p></section>
    <section><h3>Objective summary</h3><p>${escapeHtml(s.sessionSummary)}</p></section>
    <section><h3>Pupil’s voice</h3><p>${escapeHtml(s.childVoice || "Not recorded")}</p></section>
    <section><h3>Intervention and response</h3><p>${escapeHtml(s.interventionResponse)}</p></section>
    <section class="risk-preview"><h3>Safeguarding judgement</h3><p>${escapeHtml(s.riskEvidence)}</p><p><strong>Decision:</strong> ${escapeHtml(s.decisionRationale || "Not recorded")}</p>${s.safetyAction ? `<p><strong>Action:</strong> ${escapeHtml(s.safetyAction)}</p>` : ""}</section>
    <section><h3>Next plan</h3><p>${escapeHtml(s.nextPlan)}</p>${s.actionStatus === "open" ? `<p><strong>Owner:</strong> ${escapeHtml(s.actionOwner || "Not assigned")} · <strong>Due:</strong> ${s.followupDate ? formatDate(s.followupDate) : "Not set"}</p>` : ""}</section>
    <div class="preview-actions"><button data-action="edit-session">Edit</button><button data-action="print-session">Print record</button><button data-action="dsl-summary" class="primary">Prepare DSL summary</button></div>`;
}
function openPupilDialog(pupil = {}) {
  if (!pupil.id && !requireActiveLicenceOrTrial()) return;
  $("pupilForm").reset();
  $("pupilId").value = pupil.id || "";
  $("pupilCode").value = pupil.code || "";
  $("yearGroup").value = pupil.yearGroup || "";
  $("ageBand").value = pupil.ageBand || "";
  $("pupilStatus").value = pupil.status || "active";
  $("referralDate").value = formatUkDateInput(pupil.referralDate);
  $("referralSource").value = pupil.referralSource || "";
  $("pupilContext").value = pupil.context || "";
  $("pupilSupport").value = pupil.support || "";
  $("parentInvolvement").value = pupil.parentInvolvement || "";
  $("pupilTags").value = pupil.tags || "";
  $("pupilDialogTitle").textContent = pupil.id ? "Edit pupil profile" : "Add pupil";
  $("pupilDialog").showModal();
}
async function savePupil(event) {
  event.preventDefault();
  if (!validateUkDateField("referralDate")) return;
  const id = $("pupilId").value || crypto.randomUUID();
  const existing = pupils.find((p) => p.id === id);
  const pupil = {
    id,
    code: $("pupilCode").value.trim(),
    yearGroup: $("yearGroup").value.trim(),
    ageBand: $("ageBand").value.trim(),
    status: $("pupilStatus").value,
    referralDate: ukDateToIso($("referralDate").value),
    referralSource: $("referralSource").value.trim(),
    context: $("pupilContext").value.trim(),
    support: $("pupilSupport").value.trim(),
    parentInvolvement: $("parentInvolvement").value.trim(),
    tags: $("pupilTags").value.trim(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (pupils.some((p) => p.code.toLowerCase() === pupil.code.toLowerCase() && p.id !== id)) {
    toast("That pupil code is already in use.");
    return;
  }
  pupils = existing ? pupils.map((p) => p.id === id ? pupil : p) : [...pupils, pupil];
  await saveCollection("pupils", pupils);
  $("pupilDialog").close();
  refreshAll();
  toast("Pupil profile saved.");
}
function nextSessionNumber(pupilId) {
  return sessions.filter((s) => s.pupilId === pupilId).length + 1;
}
function openSessionDialog(session = {}, pupilId = "") {
  if (!session.id && !requireActiveLicenceOrTrial()) return;
  $("sessionForm").reset();
  sessionTextFields.forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  sessionChecks.forEach((id) => { $(id).checked = false; });
  $("sessionId").value = session.id || "";
  $("sessionPupil").value = session.pupilId || pupilId || "";
  $("sessionDate").value = formatUkDateInput(session.sessionDate) || todayUk();
  $("startTime").value = session.startTime || new Date().toTimeString().slice(0, 5);
  $("duration").value = session.duration || "50";
  $("sessionNumber").value = session.sessionNumber || nextSessionNumber(session.pupilId || pupilId);
  $("counsellor").value = session.counsellor || settings.counsellor || "";
  $("modality").value = session.modality || "In person";
  $("location").value = session.location || "";
  $("attendance").value = session.attendance || "Attended";
  $("consentNote").value = session.consentNote || "";
  $("presentingIssue").value = session.presentingIssue || "";
  $("sessionSummary").value = session.sessionSummary || "";
  $("interventionResponse").value = session.interventionResponse || "";
  $("childVoice").value = session.childVoice || "";
  $("observations").value = session.observations || "";
  $("protectiveFactors").value = session.protectiveFactors || "";
  $("educationImpact").value = session.educationImpact || "";
  $("riskLevel").value = session.riskLevel || "none";
  $("riskEvidence").value = session.riskEvidence || "Safety and safeguarding were considered. No current concern was reported or observed.";
  $("safetyAction").value = session.safetyAction || "";
  $("disclosure").value = session.disclosure || "";
  $("decisionRationale").value = session.decisionRationale || "";
  $("safeguardingReference").value = session.safeguardingReference || "";
  $("nextPlan").value = session.nextPlan || "";
  $("referralFollowup").value = session.referralFollowup || "";
  $("actionOwner").value = session.actionOwner || "";
  $("followupDate").value = formatUkDateInput(session.followupDate);
  $("actionStatus").value = session.actionStatus || "none";
  $("actionOutcome").value = session.actionOutcome || "";
  $("supervision").value = session.supervision || "";
  $("sessionTags").value = session.sessionTags || "";
  sessionChecks.forEach((id) => { $(id).checked = Boolean(session[id]); });
  document.querySelectorAll('input[name="riskArea"]').forEach((box) => {
    box.checked = (session.riskAreas || ["None identified"]).includes(box.value);
  });
  $("sessionDialogTitle").textContent = session.id ? `Edit ${pupilCode(session.pupilId)} session` : "New session";
  $("deleteSessionBtn").classList.toggle("hidden", !session.id);
  $("sessionDialog").showModal();
}
function collectSession() {
  const id = $("sessionId").value || crypto.randomUUID();
  const existing = sessions.find((s) => s.id === id);
  const data = { id };
  sessionTextFields.forEach((field) => {
    if (field === "sessionId") return;
    data[field] = $(field).value.trim();
  });
  data.pupilId = data.sessionPupil;
  delete data.sessionPupil;
  data.sessionDate = ukDateToIso(data.sessionDate);
  data.followupDate = ukDateToIso(data.followupDate);
  sessionChecks.forEach((field) => { data[field] = $(field).checked; });
  data.riskAreas = [...document.querySelectorAll('input[name="riskArea"]:checked')].map((box) => box.value);
  data.createdAt = existing?.createdAt || new Date().toISOString();
  data.updatedAt = new Date().toISOString();
  return data;
}
async function saveSession(event) {
  event.preventDefault();
  if (!validateUkDateField("sessionDate", true) || !validateUkDateField("followupDate")) return;
  if (!$("sessionForm").reportValidity()) return;
  const session = collectSession();
  if (!session.riskAreas.length) {
    toast("Confirm at least one risk area or ‘None identified’.");
    return;
  }
  if (session.riskLevel !== "none" && (!session.safetyAction || !session.disclosure)) {
    toast("When risk is present, record action and consultation/disclosure rationale.");
    return;
  }
  if (session.riskLevel !== "none" && !session.safeguardingRecorded) {
    toast("Confirm that the concern has been recorded in the school’s approved child-protection system.");
    return;
  }
  if (session.actionStatus === "open" && (!session.actionOwner || !session.followupDate)) {
    toast("An open action requires an owner and due date.");
    return;
  }
  const exists = sessions.some((s) => s.id === session.id);
  sessions = exists ? sessions.map((s) => s.id === session.id ? session : s) : [...sessions, session];
  await saveCollection("sessions", sessions);
  selectedSessionId = session.id;
  $("sessionDialog").close();
  refreshAll();
  switchView("sessions");
  renderSessionPreview(session.id);
  toast("Session encrypted and saved.");
}
function requestDelete(type, id) {
  pendingDelete = { type, id };
  $("confirmTitle").textContent = type === "session" ? "Delete this session?" : "Delete this record?";
  $("confirmText").textContent = "This action cannot be undone. Create an encrypted backup first if required.";
  $("confirmDialog").showModal();
}
async function completeDelete() {
  if (!pendingDelete) return;
  if (pendingDelete.type === "session") {
    sessions = sessions.filter((s) => s.id !== pendingDelete.id);
    await saveCollection("sessions", sessions);
    selectedSessionId = "";
  }
  pendingDelete = null;
  refreshAll();
  toast("Record deleted.");
}
function prepareDslSummary(session) {
  const pupil = pupilById(session.pupilId);
  const lines = [
    "SAFEGUARDING SUMMARY — REVIEW BEFORE SHARING",
    "",
    `Pupil code: ${pupil?.code || "Unknown"}`,
    `Date/time of concern: ${formatDate(session.sessionDate)} ${session.startTime}`,
    `Recorded by: ${session.counsellor}`,
    `Risk level: ${session.riskLevel.toUpperCase()}`,
    `Areas checked: ${(session.riskAreas || []).join(", ")}`,
    "",
    "Concern / information requiring action:",
    session.riskEvidence || "No safeguarding information recorded.",
    "",
    "Pupil’s voice, wishes and feelings:",
    session.childVoice || "Not recorded.",
    "",
    "Immediate action / safety plan:",
    session.safetyAction || "No action recorded.",
    "",
    "Consultation or disclosure already made:",
    session.disclosure || "None recorded.",
    "",
    "Decision and rationale:",
    session.decisionRationale || "Not recorded.",
    "",
    `School safeguarding-record reference: ${session.safeguardingReference || "Not recorded"}`,
    "",
    "Required follow-up:",
    session.referralFollowup || session.nextPlan || "Review required.",
    session.actionOwner ? `Owner: ${session.actionOwner}` : "",
    session.followupDate ? `Due: ${formatDate(session.followupDate)}` : "",
    "",
    "This summary intentionally excludes unrelated therapeutic content. Verify accuracy, necessity and the lawful/safeguarding basis before sharing."
  ].filter((line) => line !== undefined);
  $("dslSummary").value = lines.join("\n");
  $("summaryDialog").showModal();
}
function printSession(session) {
  const pupil = pupilById(session.pupilId);
  const sections = [
    ["Session details", `${pupil?.code || ""} · ${formatDate(session.sessionDate)} · ${session.startTime} · ${session.duration} minutes · ${session.counsellor}`],
    ["Presenting issue / aim", session.presentingIssue],
    ["Objective summary", session.sessionSummary],
    ["Pupil’s voice, wishes and feelings", session.childVoice],
    ["Intervention and response", session.interventionResponse],
    ["Observations", session.observations],
    ["Protective factors", session.protectiveFactors],
    ["Risk assessment", `${session.riskLevel.toUpperCase()}: ${session.riskEvidence}`],
    ["Safety action", session.safetyAction],
    ["Consultation / disclosure", session.disclosure],
    ["Decision and rationale", session.decisionRationale],
    ["Safeguarding record reference", session.safeguardingReference],
    ["Next plan", session.nextPlan],
    ["Referral / follow-up", session.referralFollowup],
    ["Action ownership and status", [session.actionOwner, session.followupDate ? formatDate(session.followupDate) : "", session.actionStatus, session.actionOutcome].filter(Boolean).join(" · ")],
    ["Supervision", session.supervision]
  ].filter(([, value]) => value);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Session record</title><style>body{font:14px/1.55 Arial;max-width:850px;margin:40px auto;color:#173532}h1{font-size:26px}h2{font-size:15px;margin:24px 0 5px;border-bottom:1px solid #ccc;padding-bottom:4px}p{white-space:pre-wrap}.notice{background:#eef5f2;padding:12px}</style></head><body><h1>Confidential counselling record</h1><p class="notice">Sensitive personal data. Handle in accordance with school policy and UK GDPR.</p>${sections.map(([title, value]) => `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(value)}</p>`).join("")}<p>Created: ${escapeHtml(session.createdAt)}<br>Last updated: ${escapeHtml(session.updatedAt)}</p><script>window.print()<\/script></body></html>`;
  const win = window.open("", "_blank");
  if (!win) return toast("Pop-up blocked. Allow pop-ups to print.");
  win.document.write(html);
  win.document.close();
}
function interpretation(measure, score, version) {
  const n = Number(score);
  if (measure === "GAD-7") {
    if (n > 21) return "Check score: GAD-7 range is 0–21.";
    return n <= 4 ? "Minimal" : n <= 9 ? "Mild" : n <= 14 ? "Moderate — consider further assessment" : "Severe — clinical review indicated";
  }
  if (measure === "PHQ-9") {
    if (n > 27) return "Check score: PHQ-9 range is 0–27.";
    return n <= 4 ? "Minimal" : n <= 9 ? "Mild" : n <= 14 ? "Moderate" : n <= 19 ? "Moderately severe" : "Severe";
  }
  if (measure === "WEMWBS") {
    if (n < 14 || n > 70) return "Check score: WEMWBS range is 14–70.";
    return "No official clinical bands. Higher scores indicate better mental wellbeing; interpret change using authorised guidance.";
  }
  if (measure === "SDQ") {
    if (n > 40) return "Check total difficulties score: expected range is 0–40.";
    return version ? "Use the official scoring band for the stated respondent/version. Prosocial score is excluded from Total Difficulties." : "Version/respondent is required for safe interpretation; SDQ bands differ.";
  }
  return "Interpret using the measure’s authorised guidance.";
}
function renderScoreGuidance() {
  const measure = $("measure").value;
  const score = $("assessmentScore").value;
  if (score === "") return $("scoreGuidance").textContent = "Enter a total score to see guidance.";
  $("scoreGuidance").textContent = interpretation(measure, score, $("assessmentVersion").value);
}
async function saveAssessment(event) {
  event.preventDefault();
  if (!validateUkDateField("assessmentDate", true)) return;
  const assessment = {
    id: crypto.randomUUID(),
    pupilId: $("assessmentPupil").value,
    measure: $("measure").value,
    date: ukDateToIso($("assessmentDate").value),
    score: Number($("assessmentScore").value),
    version: $("assessmentVersion").value.trim(),
    selfHarmPositive: $("assessmentSelfHarmPositive").checked,
    safety: $("assessmentSafety").value.trim(),
    notes: $("assessmentNotes").value.trim(),
    interpretation: interpretation($("measure").value, $("assessmentScore").value, $("assessmentVersion").value),
    createdAt: new Date().toISOString()
  };
  if (assessment.measure === "SDQ" && !assessment.version) {
    toast("Record the SDQ respondent/version before saving.");
    return;
  }
  if (assessment.selfHarmPositive && !assessment.safety) {
    toast("Record the immediate safety assessment and action before saving.");
    $("assessmentSafety").focus();
    return;
  }
  assessments.push(assessment);
  await saveCollection("assessments", assessments);
  $("assessmentDialog").close();
  renderAssessments();
  toast("Outcome measure saved.");
}
function renderAssessments() {
  const pupilFilter = $("assessmentPupilFilter").value;
  const filtered = assessments.filter((a) => !pupilFilter || a.pupilId === pupilFilter).sort((a, b) => b.date.localeCompare(a.date));
  $("assessmentList").innerHTML = filtered.length ? `<table><thead><tr><th>Date</th><th>Pupil</th><th>Measure</th><th>Score</th><th>Interpretation</th></tr></thead><tbody>${filtered.map((a) => `<tr><td>${formatDate(a.date)}</td><td>${escapeHtml(pupilCode(a.pupilId))}</td><td>${escapeHtml(a.measure)}<small>${escapeHtml(a.version)}</small></td><td><strong>${a.score}</strong></td><td>${escapeHtml(a.interpretation)}</td></tr>`).join("")}</tbody></table>` : empty("No outcome measures", "Record authorised total scores to follow change over time.");
  const chartItems = filtered.slice().reverse().slice(-12);
  const max = Math.max(1, ...chartItems.map((a) => a.score));
  $("assessmentChart").innerHTML = chartItems.length ? `<div class="bars">${chartItems.map((a) => `<div class="bar-wrap" title="${escapeHtml(a.measure)} ${a.score}"><span class="bar" style="height:${Math.max(8, (a.score / max) * 120)}px"></span><small>${escapeHtml(a.measure)}<br>${escapeHtml(a.score)}</small></div>`).join("")}</div>` : "";
}
function reportRows() {
  const grouped = new Map();
  sessions.forEach((session) => {
    const pupil = pupilById(session.pupilId);
    const yearGroup = pupil?.yearGroup || "Not recorded";
    const theme = String(session.sessionTags || "Uncategorised").split(",")[0].trim() || "Uncategorised";
    const key = `${yearGroup}|${theme}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  });
  return [...grouped.entries()].map(([key, count]) => {
    const [yearGroup, theme] = key.split("|");
    return { yearGroup, theme, count };
  }).sort((a, b) => b.count - a.count || a.yearGroup.localeCompare(b.yearGroup));
}
function renderReports() {
  const rows = reportRows();
  const openActions = sessions.filter((session) => session.actionStatus === "open").sort((a, b) => (a.followupDate || "9999").localeCompare(b.followupDate || "9999"));
  $("reportSessions").textContent = sessions.length;
  $("reportPupils").textContent = new Set(sessions.map((session) => session.pupilId)).size;
  $("reportActions").textContent = openActions.length;
  $("reportSafeguarding").textContent = sessions.filter((session) => session.riskLevel && session.riskLevel !== "none").length;
  $("serviceReport").innerHTML = rows.length ? `<table><thead><tr><th>Year group</th><th>Theme</th><th>Sessions</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.yearGroup)}</td><td>${escapeHtml(row.theme)}</td><td><strong>${row.count < 3 ? "&lt;3" : row.count}</strong></td></tr>`).join("")}</tbody></table>` : empty("No activity to report", "Aggregate reporting appears after session records are created.");
  $("actionQueue").innerHTML = openActions.length ? openActions.map((session) => `<button class="timeline-item" data-session="${escapeHtml(session.id)}"><span class="timeline-dot ${escapeHtml(session.riskLevel || "none")}"></span><span><strong>${escapeHtml(pupilCode(session.pupilId))} · ${escapeHtml(session.actionOwner || "Owner not assigned")}</strong><small>${session.followupDate ? formatDate(session.followupDate) : "No due date"} · ${escapeHtml(session.referralFollowup || session.nextPlan).slice(0, 80)}</small></span></button>`).join("") : empty("No open actions", "Open actions with an owner and due date will appear here.");
}
function exportDeidentifiedReport() {
  const rows = reportRows();
  const csv = [
    ["Year group", "Theme", "Session count"],
    ...rows.map((row) => [row.yearGroup, row.theme, row.count < 3 ? "<3" : row.count])
  ].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  downloadFile(`de-identified-service-report-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
  toast("De-identified CSV downloaded.");
}
function fillSettings() {
  $("settingProductName").value = settings.productName || "";
  $("settingLicenseKey").value = settings.licenseKey || "";
  renderLicenseStatus();
  $("settingSchoolName").value = settings.schoolName || "";
  $("settingCounsellor").value = settings.counsellor || "";
  $("settingDslName").value = settings.dslName || "";
  $("settingDslContact").value = settings.dslContact || "";
  $("settingMash").value = settings.mash || "";
  $("settingCamhs").value = settings.camhs || "";
  $("settingRetention").value = settings.retention || "";
}
async function saveSettings(event) {
  event.preventDefault();
  settings = {
    productName: $("settingProductName").value.trim() || "CounselNote",
    licenseKey: $("settingLicenseKey").value.trim().toUpperCase(),
    schoolName: $("settingSchoolName").value.trim(),
    counsellor: $("settingCounsellor").value.trim(),
    dslName: $("settingDslName").value.trim(),
    dslContact: $("settingDslContact").value.trim(),
    mash: $("settingMash").value.trim(),
    camhs: $("settingCamhs").value.trim(),
    retention: $("settingRetention").value.trim()
  };
  await saveCollection("settings", settings);
  refreshAll();
  toast("School settings saved.");
}
async function exportBackup() {
  const rows = await dbRequest("readonly", (store) => store.getAll());
  const backup = {
    app: "school-counselling-record",
    version: 2,
    exportedAt: new Date().toISOString(),
    salt: localStorage.getItem(META_SALT),
    check: localStorage.getItem(META_CHECK),
    rows
  };
  downloadFile(`counselling-record-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), "application/json");
  toast("Encrypted backup downloaded.");
}
async function importBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (backup.app !== "school-counselling-record" || !Array.isArray(backup.rows)) throw new Error("invalid");
    if (backup.salt !== localStorage.getItem(META_SALT)) {
      toast("This backup uses a different vault key. Restore it in a fresh browser profile with its original passphrase.");
      return;
    }
    for (const row of backup.rows) await dbRequest("readwrite", (store) => store.put(row));
    [pupils, sessions, assessments, settings] = await Promise.all([
      readCollection("pupils", []), readCollection("sessions", []), readCollection("assessments", []), readCollection("settings", {})
    ]);
    refreshAll();
    toast("Encrypted backup restored.");
  } catch {
    toast("That is not a valid encrypted backup.");
  } finally {
    $("importInput").value = "";
  }
}
async function importLockedVault(file) {
  try {
    if (localStorage.getItem(META_CHECK)) {
      $("lockError").textContent = "A vault already exists here. Open it first, then use Restore backup inside the app.";
      return;
    }
    const backup = JSON.parse(await file.text());
    if (backup.app !== "school-counselling-record" || backup.version !== 2 || !backup.salt || !backup.check || !Array.isArray(backup.rows)) {
      throw new Error("invalid");
    }
    db = await openDb();
    for (const row of backup.rows) await dbRequest("readwrite", (store) => store.put(row));
    localStorage.setItem(META_SALT, backup.salt);
    localStorage.setItem(META_CHECK, backup.check);
    $("lockError").textContent = "Encrypted vault restored. Enter its original passphrase to open it.";
    $("passphrase").focus();
  } catch {
    $("lockError").textContent = "That is not a valid encrypted vault backup.";
  } finally {
    $("lockedImportInput").value = "";
  }
}
function downloadFile(name, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

$("unlockBtn").addEventListener("click", unlock);
$("passphrase").addEventListener("keydown", (event) => { if (event.key === "Enter") unlock(); });
$("lockBtn").addEventListener("click", lockVault);
$("exportBtn").addEventListener("click", exportBackup);
$("importInput").addEventListener("change", (event) => event.target.files[0] && importBackup(event.target.files[0]));
$("lockedImportInput").addEventListener("change", (event) => event.target.files[0] && importLockedVault(event.target.files[0]));
document.querySelector(".side-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) switchView(button.dataset.view);
});
document.addEventListener("click", (event) => {
  const go = event.target.closest("[data-go]");
  if (go) switchView(go.dataset.go);
  const close = event.target.closest("[data-close]");
  if (close) $(close.dataset.close).close();
});
document.addEventListener("pointerdown", resetAutoLock);
document.addEventListener("keydown", resetAutoLock);
$("newPupilBtn").addEventListener("click", () => openPupilDialog());
$("pupilForm").addEventListener("submit", savePupil);
["referralDate", "sessionDate", "followupDate", "assessmentDate"].forEach((id) => {
  $(id).addEventListener("input", (event) => {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
    event.target.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)].filter(Boolean).join("-");
    event.target.setCustomValidity("");
  });
});
document.querySelectorAll("[data-date-picker]").forEach((button) => {
  button.addEventListener("click", () => {
    const picker = $(button.dataset.datePicker);
    const display = $(button.dataset.datePicker.replace("Picker", ""));
    picker.value = ukDateToIso(display.value);
    if (typeof picker.showPicker === "function") picker.showPicker();
    else picker.click();
  });
});
document.querySelectorAll(".native-date-picker").forEach((picker) => {
  picker.addEventListener("change", () => {
    const display = $(picker.id.replace("Picker", ""));
    display.value = formatUkDateInput(picker.value);
    display.setCustomValidity("");
  });
});
$("pupilSearch").addEventListener("input", renderPupils);
$("pupilGrid").addEventListener("click", (event) => {
  const card = event.target.closest("[data-pupil]");
  if (!card) return;
  const pupil = pupilById(card.dataset.pupil);
  if (event.target.closest(".edit-pupil")) openPupilDialog(pupil);
  else {
    switchView("sessions");
    $("sessionSearch").value = pupil.code;
    renderSessions();
  }
});
[$("newSessionBtn"), $("newSessionSideBtn")].forEach((button) => button.addEventListener("click", () => {
  if (!pupils.some((p) => p.status !== "closed")) {
    toast("Add an active pupil profile first.");
    switchView("pupils");
    return;
  }
  openSessionDialog();
}));
$("sessionForm").addEventListener("submit", saveSession);
$("sessionPupil").addEventListener("change", () => { if (!$("sessionId").value) $("sessionNumber").value = nextSessionNumber($("sessionPupil").value); });
$("sessionSearch").addEventListener("input", renderSessions);
$("sessionFilter").addEventListener("change", renderSessions);
$("sessionList").addEventListener("click", (event) => {
  const row = event.target.closest("[data-session]");
  if (!row) return;
  selectedSessionId = row.dataset.session;
  renderSessions();
});
$("recentSessions").addEventListener("click", (event) => {
  const row = event.target.closest("[data-session]");
  if (!row) return;
  selectedSessionId = row.dataset.session;
  switchView("sessions");
  renderSessions();
});
$("sessionPreview").addEventListener("click", (event) => {
  const session = sessions.find((s) => s.id === selectedSessionId);
  if (!session) return;
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "edit-session") openSessionDialog(session);
  if (action === "print-session") printSession(session);
  if (action === "dsl-summary") prepareDslSummary(session);
});
$("deleteSessionBtn").addEventListener("click", () => {
  $("sessionDialog").close();
  requestDelete("session", $("sessionId").value);
});
$("confirmDialog").addEventListener("close", () => {
  if ($("confirmDialog").returnValue === "confirm") completeDelete();
  else pendingDelete = null;
});
document.querySelectorAll('input[name="riskArea"]').forEach((box) => box.addEventListener("change", () => {
  const none = document.querySelector('input[name="riskArea"][value="None identified"]');
  if (box === none && box.checked) document.querySelectorAll('input[name="riskArea"]').forEach((item) => { if (item !== none) item.checked = false; });
  else if (box.checked) none.checked = false;
}));
$("newAssessmentBtn").addEventListener("click", () => {
  if (!pupils.length) return toast("Add a pupil profile first.");
  $("assessmentForm").reset();
  $("assessmentDate").value = todayUk();
  renderScoreGuidance();
  $("assessmentDialog").showModal();
});
$("assessmentForm").addEventListener("submit", saveAssessment);
["measure", "assessmentScore", "assessmentVersion"].forEach((id) => $(id).addEventListener("input", renderScoreGuidance));
$("assessmentPupilFilter").addEventListener("change", renderAssessments);
$("exportReportBtn").addEventListener("click", exportDeidentifiedReport);
$("actionQueue").addEventListener("click", (event) => {
  const row = event.target.closest("[data-session]");
  if (!row) return;
  selectedSessionId = row.dataset.session;
  switchView("sessions");
  renderSessions();
});
$("settingsForm").addEventListener("submit", saveSettings);
$("copySummaryBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("dslSummary").value);
  toast("DSL summary copied.");
});
$("downloadSummaryBtn").addEventListener("click", () => downloadFile(`dsl-summary-${new Date().toISOString().slice(0, 10)}.txt`, $("dslSummary").value));
window.addEventListener("beforeunload", () => clearTimeout(lockTimer));
