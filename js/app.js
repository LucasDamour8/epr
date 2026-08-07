// js/app.js
import {
  auth, db, secondaryAuth,
  onAuthStateChanged, signOut,
  createUserWithEmailAndPassword,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  addDoc, collection, query, where, onSnapshot, serverTimestamp
} from "./firebase-config.js";
import {
  DEPARTMENTS, PRESBYTERIES, allScopes, scopeLabel,
  ACCOUNT_TYPES, accountTypeLabel, accountTypeColor,
  MODULES, formatCurrency, INVOICE_STATUSES, BILL_STATUSES
} from "./structure.js";

let currentUser = null;     // { uid, email }
let profile = null;         // { name, email, role, scopeType, scopeId }

let unsubscribeRecords = null;
let unsubscribeUsers = null;
let unsubscribeReports = null;
let unsubscribeAccounts = null;
let unsubscribeModule = null;
let unsubscribeDocs = null;   // invoices / bills

let cachedRecords = [];
let cachedAccounts = [];
let cachedModuleRows = [];
let cachedDocs = [];          // invoices or bills currently on screen

let activeCategory = "All";
let activeAccountType = "All";

let editingRecordId = null;
let editingUserId = null;
let editingAccountId = null;
let editingModuleId = null;
let editingDocId = null;

// Reports state — persists while navigating so filters don't reset every click
let reportScope = "all";        // "all" | "department:<id>" | "presbytery:<id>"
let reportPreset = "30d";       // "today" | "7d" | "30d" | "annual" | "custom"
let reportCustomFrom = "";
let reportCustomTo = "";
let reportRecords = [];

const $ = (id) => document.getElementById(id);

/* ============================= AUTH GUARD ============================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    // No role assigned — this account isn't provisioned. Kick back to login.
    await signOut(auth);
    window.location.href = "index.html";
    return;
  }
  profile = snap.data();

  $("whoName").textContent = profile.name || currentUser.email;
  $("whoRole").textContent = profile.role === "superadmin"
    ? "EPR Super Admin"
    : scopeLabel(profile.scopeType, profile.scopeId);
  $("avatarInitial").textContent = (profile.name || currentUser.email).charAt(0).toUpperCase();

  buildSidebar();

  // Land on the user's home view.
  if (!location.hash) {
    location.hash = profile.role === "superadmin"
      ? "#/overview"
      : `#/${profile.scopeType}/${profile.scopeId}`;
  } else {
    route();
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

window.addEventListener("hashchange", route);

/* ========================= FINANCE ACCESS RULE ========================== */
// Only the Super Admin and staff assigned to the Finance & Administration
// department can create/edit/delete finance records. Everyone else (other
// departments, presbyteries) can view them — useful for cross-checking —
// but can't change them.
function canEditFinance() {
  return profile.role === "superadmin" ||
    (profile.scopeType === "department" && profile.scopeId === "finance_admin");
}

/* ============================== SIDEBAR ================================ */

function buildSidebar() {
  const nav = $("navList");
  nav.innerHTML = "";

  if (profile.role === "superadmin") {
    nav.appendChild(navItem("Overview", "#/overview"));
    nav.appendChild(navItem("Reports", "#/reports"));

    nav.appendChild(sectionLabel("Departments"));
    for (const [id, d] of Object.entries(DEPARTMENTS)) {
      nav.appendChild(navItem(d.name, `#/department/${id}`));
    }

    nav.appendChild(sectionLabel("Presbyteries"));
    for (const [id, p] of Object.entries(PRESBYTERIES)) {
      nav.appendChild(navItem(p.name, `#/presbytery/${id}`));
    }

    appendFinanceNav(nav);

    nav.appendChild(sectionLabel("Administration"));
    nav.appendChild(navItem("Manage staff accounts", "#/users"));
  } else {
    // A department/presbytery user only ever sees their own scope + reports
    // + the finance section (view-only unless they're Finance & Admin staff).
    const label = scopeLabel(profile.scopeType, profile.scopeId);
    nav.appendChild(navItem(label, `#/${profile.scopeType}/${profile.scopeId}`));
    nav.appendChild(navItem("Reports", "#/reports"));

    appendFinanceNav(nav);
  }
}

function appendFinanceNav(nav) {
  nav.appendChild(sectionLabel("Finance & Administration"));
  nav.appendChild(navItem("Chart of Accounts", "#/accounts"));
  nav.appendChild(navItem("Invoices", "#/invoices"));
  nav.appendChild(navItem("Bills", "#/bills"));
  nav.appendChild(navItem("Record Expense", "#/module/expenses"));
  nav.appendChild(navItem("Record Income", "#/module/income"));
  nav.appendChild(navItem("Customers", "#/module/customers"));
  nav.appendChild(navItem("Suppliers", "#/module/suppliers"));
  nav.appendChild(navItem("Inventory", "#/module/inventory"));
  nav.appendChild(navItem("Projects", "#/module/projects"));
  nav.appendChild(navItem("Make Budget", "#/module/budgets"));
  nav.appendChild(navItem("Financial Statements", "#/financials"));
}

function sectionLabel(text) {
  const el = document.createElement("div");
  el.className = "nav-section-label";
  el.textContent = text;
  return el;
}

function navItem(label, hash) {
  const a = document.createElement("a");
  a.className = "nav-item";
  a.href = hash;
  a.dataset.hash = hash;
  a.innerHTML = `<span class="dot"></span><span>${label}</span>`;
  return a;
}

function highlightActiveNav() {
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.hash === location.hash);
  });
}

/* =============================== ROUTER ================================= */

function route() {
  highlightActiveNav();
  cleanupListeners();

  const parts = location.hash.replace("#/", "").split("/");
  const [scopeType, scopeId] = parts;

  // Guard: staff can only ever view their own assigned scope. Reports and
  // the whole Finance & Administration section are exempt — everyone may
  // see them; edit rights inside finance are handled by canEditFinance().
  if (profile.role !== "superadmin") {
    const exempt = ["reports", "accounts", "module", "invoices", "bills", "financials"].includes(scopeType);
    if (!exempt && (scopeType !== profile.scopeType || scopeId !== profile.scopeId)) {
      location.hash = `#/${profile.scopeType}/${profile.scopeId}`;
      return;
    }
  }

  if (scopeType === "overview" && profile.role === "superadmin") {
    renderOverview();
  } else if (scopeType === "reports") {
    renderReports();
  } else if (scopeType === "accounts") {
    renderAccounts();
  } else if (scopeType === "users" && profile.role === "superadmin") {
    renderUsers();
  } else if (scopeType === "module" && MODULES[scopeId]) {
    renderModule(scopeId);
  } else if (scopeType === "invoices") {
    renderDocList("invoice");
  } else if (scopeType === "bills") {
    renderDocList("bill");
  } else if (scopeType === "financials") {
    renderFinancials();
  } else if (scopeType === "department" && DEPARTMENTS[scopeId]) {
    renderScope("department", scopeId);
  } else if (scopeType === "presbytery" && PRESBYTERIES[scopeId]) {
    renderScope("presbytery", scopeId);
  } else {
    location.hash = profile.role === "superadmin" ? "#/overview" : `#/${profile.scopeType}/${profile.scopeId}`;
  }
}

function cleanupListeners() {
  if (unsubscribeRecords) { unsubscribeRecords(); unsubscribeRecords = null; }
  if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
  if (unsubscribeReports) { unsubscribeReports(); unsubscribeReports = null; }
  if (unsubscribeAccounts) { unsubscribeAccounts(); unsubscribeAccounts = null; }
  if (unsubscribeModule) { unsubscribeModule(); unsubscribeModule = null; }
  if (unsubscribeDocs) { unsubscribeDocs(); unsubscribeDocs = null; }
}

/* ============================== OVERVIEW ================================ */

function renderOverview() {
  $("pageTitle").textContent = "Overview";
  $("pageCrumb").textContent = "All departments and presbyteries — EPR Super Admin";
  $("pageActions").innerHTML = "";

  const allIds = [
    ...Object.entries(DEPARTMENTS).map(([id, d]) => ({ type: "department", id, name: d.name })),
    ...Object.entries(PRESBYTERIES).map(([id, p]) => ({ type: "presbytery", id, name: p.name }))
  ];

  $("content").innerHTML = `
    <div class="stat-grid" id="statGrid">
      ${allIds.map(s => `
        <div class="stat-card">
          <div class="label">${s.name}</div>
          <div class="stat-value" id="stat-${s.type}-${s.id}">—</div>
        </div>`).join("")}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Jump to a section</h2></div>
      <div class="panel-body">
        <div class="chips">
          ${allIds.map(s => `<a class="chip" href="#/${s.type}/${s.id}">${s.name}</a>`).join("")}
          <a class="chip" href="#/invoices">Invoices</a>
          <a class="chip" href="#/bills">Bills</a>
          <a class="chip" href="#/financials">Financial Statements</a>
        </div>
      </div>
    </div>
  `;

  unsubscribeRecords = onSnapshot(collection(db, "records"), (snap) => {
    const counts = {};
    snap.forEach(d => {
      const r = d.data();
      const key = `${r.scopeType}-${r.scopeId}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    allIds.forEach(s => {
      const el = $(`stat-${s.type}-${s.id}`);
      if (el) el.textContent = counts[`${s.type}-${s.id}`] || 0;
    });
  });
}

/* ======================== DEPARTMENT / PRESBYTERY ======================== */

function renderScope(scopeType, scopeId) {
  const isDept = scopeType === "department";
  const meta = isDept ? DEPARTMENTS[scopeId] : PRESBYTERIES[scopeId];
  activeCategory = "All";

  $("pageTitle").textContent = meta.name;
  $("pageCrumb").textContent = profile.role === "superadmin"
    ? "Viewing as EPR Super Admin — full access"
    : "Your department — view and manage your own data";
  $("pageActions").innerHTML = `
    <span style="display:flex;gap:8px;">
      <button class="btn btn-ghost" style="width:auto;" id="viewReportBtn">📊 View report</button>
      <button class="btn btn-primary" style="width:auto;" id="addRecordBtn">+ Add record</button>
    </span>
  `;
  $("addRecordBtn").addEventListener("click", () => openRecordModal(scopeType, scopeId));
  $("viewReportBtn").addEventListener("click", () => {
    reportScope = `${scopeType}:${scopeId}`;
    location.hash = "#/reports";
  });

  const categoryChips = isDept
    ? `<div class="chips" id="categoryChips" style="margin-bottom:18px;">
         ${["All", ...meta.categories].map(c =>
            `<button type="button" class="chip ${c === "All" ? "active" : ""}" data-cat="${c}">${c}</button>`
          ).join("")}
       </div>`
    : "";

  $("content").innerHTML = `
    ${categoryChips}
    <div class="panel">
      <div class="panel-head">
        <h2>Records</h2>
      </div>
      <div class="panel-body" id="recordsBody">
        <div class="empty-state">Loading…</div>
      </div>
    </div>
  `;

  if (isDept) {
    document.querySelectorAll("#categoryChips .chip").forEach(chip => {
      chip.addEventListener("click", () => {
        activeCategory = chip.dataset.cat;
        document.querySelectorAll("#categoryChips .chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        paintRecords(scopeType, scopeId);
      });
    });
  }

  const q = query(collection(db, "records"), where("scopeType", "==", scopeType), where("scopeId", "==", scopeId));
  unsubscribeRecords = onSnapshot(q, (snap) => {
    cachedRecords = [];
    snap.forEach(d => cachedRecords.push({ id: d.id, ...d.data() }));
    cachedRecords.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
    paintRecords(scopeType, scopeId);
  }, (err) => {
    $("recordsBody").innerHTML = `<div class="empty-state">Couldn't load records. ${err.message}</div>`;
  });
}

function paintRecords(scopeType, scopeId) {
  const body = $("recordsBody");
  const rows = activeCategory === "All" ? cachedRecords : cachedRecords.filter(r => r.category === activeCategory);

  if (rows.length === 0) {
    body.innerHTML = `<div class="empty-state"><div class="big">No records yet</div>Add your first record using the button above.</div>`;
    return;
  }

  const isDept = scopeType === "department";
  body.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr>
          ${isDept ? "<th>Category</th>" : ""}
          <th>Title</th><th>Status</th><th>Date</th><th>Notes</th><th></th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              ${isDept ? `<td><span class="tag gold">${r.category || "—"}</span></td>` : ""}
              <td><strong>${escapeHtml(r.title)}</strong></td>
              <td><span class="tag">${r.status || "Planned"}</span></td>
              <td>${r.date || "—"}</td>
              <td>${escapeHtml(r.description || "—")}</td>
              <td class="row-actions">
                <button class="btn btn-ghost btn-sm" data-edit="${r.id}">Edit</button>
                <button class="btn btn-danger btn-sm" data-del="${r.id}">Delete</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  body.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const rec = cachedRecords.find(r => r.id === btn.dataset.edit);
      openRecordModal(scopeType, scopeId, rec);
    });
  });
  body.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("Delete this record? This cannot be undone.")) {
        await deleteDoc(doc(db, "records", btn.dataset.del));
      }
    });
  });
}

/* =============================== REPORTS ================================= */

const RANGE_LABELS = { today: "Today", "7d": "7 Days", "30d": "30 Days", annual: "Annual", custom: "Custom" };

function pad2(n) { return String(n).padStart(2, "0"); }
function toDateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function computeReportRange() {
  const today = new Date();
  const todayStr = toDateStr(today);

  if (reportPreset === "today") return { from: todayStr, to: todayStr };

  if (reportPreset === "7d") {
    const from = new Date(today); from.setDate(from.getDate() - 6);
    return { from: toDateStr(from), to: todayStr };
  }

  if (reportPreset === "30d") {
    const from = new Date(today); from.setDate(from.getDate() - 29);
    return { from: toDateStr(from), to: todayStr };
  }

  if (reportPreset === "annual") {
    return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
  }

  return { from: reportCustomFrom || null, to: reportCustomTo || null };
}

function renderReports() {
  $("pageTitle").textContent = "Reports";
  $("pageCrumb").textContent = "Filter, review, and print an activity report";
  $("pageActions").innerHTML = `<button class="btn btn-primary" style="width:auto;" id="printReportBtn">🖨 Print report</button>`;
  $("printReportBtn").addEventListener("click", () => window.print());

  if (profile.role !== "superadmin") {
    reportScope = `${profile.scopeType}:${profile.scopeId}`;
  }

  const scopeControlHtml = profile.role === "superadmin"
    ? `<div class="field">
         <label for="reportScopeSelect">Report scope</label>
         <select id="reportScopeSelect">
           <option value="all">Overall — all departments &amp; presbyteries</option>
           <optgroup label="Departments">
             ${Object.entries(DEPARTMENTS).map(([id, d]) => `<option value="department:${id}">${d.name}</option>`).join("")}
           </optgroup>
           <optgroup label="Presbyteries">
             ${Object.entries(PRESBYTERIES).map(([id, p]) => `<option value="presbytery:${id}">${p.name}</option>`).join("")}
           </optgroup>
         </select>
       </div>`
    : `<div class="field">
         <label>Report scope</label>
         <input type="text" value="${scopeLabel(profile.scopeType, profile.scopeId)}" disabled>
       </div>`;

  $("content").innerHTML = `
    <div class="panel no-print">
      <div class="panel-body">
        <div class="report-controls">
          ${scopeControlHtml}
          <div class="field">
            <label>Date range</label>
            <div class="chips" id="rangeChips">
              ${Object.keys(RANGE_LABELS).map(p => `
                <button type="button" class="chip ${reportPreset === p ? "active" : ""}" data-range="${p}">${RANGE_LABELS[p]}</button>
              `).join("")}
            </div>
          </div>
          <div class="field" id="customRangeFields" style="display:${reportPreset === "custom" ? "flex" : "none"};gap:10px;">
            <div style="flex:1;min-width:140px;">
              <label for="customFrom">From</label>
              <input type="date" id="customFrom" value="${reportCustomFrom}">
            </div>
            <div style="flex:1;min-width:140px;">
              <label for="customTo">To</label>
              <input type="date" id="customTo" value="${reportCustomTo}">
            </div>
          </div>
        </div>
        <p style="font-size:12.5px;color:var(--ink-soft);margin:14px 0 0;">Only records with a date set are included in the report.</p>
      </div>
    </div>

    <div id="reportPrintArea">
      <div class="print-header">
        <div class="print-crest">EPR</div>
        <div>
          <h2 id="printTitle">Activity Report</h2>
          <div id="printMeta" class="crumb"></div>
        </div>
      </div>

      <div class="stat-grid" id="reportSummary"></div>

      <div class="panel">
        <div class="panel-head"><h2>Records</h2></div>
        <div class="panel-body" id="reportBody"><div class="empty-state">Loading…</div></div>
      </div>
    </div>
  `;

  if (profile.role === "superadmin") {
    $("reportScopeSelect").value = reportScope;
    $("reportScopeSelect").addEventListener("change", (e) => {
      reportScope = e.target.value;
      subscribeReportData();
    });
  }

  document.querySelectorAll("#rangeChips .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      reportPreset = chip.dataset.range;
      document.querySelectorAll("#rangeChips .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      $("customRangeFields").style.display = reportPreset === "custom" ? "flex" : "none";
      paintReport();
    });
  });

  const customFromEl = $("customFrom");
  const customToEl = $("customTo");
  if (customFromEl) customFromEl.addEventListener("change", () => { reportCustomFrom = customFromEl.value; paintReport(); });
  if (customToEl) customToEl.addEventListener("change", () => { reportCustomTo = customToEl.value; paintReport(); });

  subscribeReportData();
}

function subscribeReportData() {
  if (unsubscribeReports) { unsubscribeReports(); unsubscribeReports = null; }
  if ($("reportBody")) $("reportBody").innerHTML = `<div class="empty-state">Loading…</div>`;

  let q;
  if (reportScope === "all") {
    q = collection(db, "records");
  } else {
    const [scopeType, scopeId] = reportScope.split(":");
    q = query(collection(db, "records"), where("scopeType", "==", scopeType), where("scopeId", "==", scopeId));
  }

  unsubscribeReports = onSnapshot(q, (snap) => {
    reportRecords = [];
    snap.forEach(d => reportRecords.push({ id: d.id, ...d.data() }));
    paintReport();
  }, (err) => {
    if ($("reportBody")) $("reportBody").innerHTML = `<div class="empty-state">Couldn't load records. ${err.message}</div>`;
  });
}

function paintReport() {
  if (!$("reportBody")) return;

  const { from, to } = computeReportRange();
  const rangeValid = reportPreset !== "custom" || (from && to);

  let rows = rangeValid
    ? reportRecords.filter(r => r.date && (!from || r.date >= from) && (!to || r.date <= to))
    : [];
  rows = rows.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const scopeLabelText = reportScope === "all"
    ? "Overall — all departments & presbyteries"
    : (() => { const [t, i] = reportScope.split(":"); return scopeLabel(t, i); })();

  const rangeLabelText = reportPreset === "custom"
    ? (rangeValid ? `${from} to ${to}` : "Select a custom date range")
    : { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", annual: `Calendar year ${new Date().getFullYear()}` }[reportPreset];

  $("printTitle").textContent = reportScope === "all" ? "Overall Activity Report" : `${scopeLabelText} — Activity Report`;
  $("printMeta").textContent = `Range: ${rangeLabelText} · Generated ${new Date().toLocaleString()} · By ${profile.name || currentUser.email}`;

  const statusCounts = { Planned: 0, Ongoing: 0, Completed: 0 };
  rows.forEach(r => { statusCounts[r.status || "Planned"] = (statusCounts[r.status || "Planned"] || 0) + 1; });

  $("reportSummary").innerHTML = [
    { label: "Total records", value: rows.length },
    { label: "Planned", value: statusCounts.Planned },
    { label: "Ongoing", value: statusCounts.Ongoing },
    { label: "Completed", value: statusCounts.Completed }
  ].map(c => `<div class="stat-card"><div class="label">${c.label}</div><div class="stat-value">${c.value}</div></div>`).join("");

  if (!rangeValid) {
    $("reportBody").innerHTML = `<div class="empty-state">Choose a "From" and "To" date to generate the report.</div>`;
    return;
  }
  if (rows.length === 0) {
    $("reportBody").innerHTML = `<div class="empty-state"><div class="big">No records in this range</div>Try a wider date range or a different scope.</div>`;
    return;
  }

  const showScopeCol = reportScope === "all";
  $("reportBody").innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr>
          ${showScopeCol ? "<th>Scope</th>" : ""}
          <th>Category</th><th>Title</th><th>Status</th><th>Date</th><th>Notes</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              ${showScopeCol ? `<td>${escapeHtml(scopeLabel(r.scopeType, r.scopeId))}</td>` : ""}
              <td>${r.category ? `<span class="tag gold">${escapeHtml(r.category)}</span>` : "—"}</td>
              <td><strong>${escapeHtml(r.title)}</strong></td>
              <td><span class="tag">${r.status || "Planned"}</span></td>
              <td>${r.date || "—"}</td>
              <td>${escapeHtml(r.description || "—")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* ============================ RECORD MODAL ============================== */

function openRecordModal(scopeType, scopeId, record = null) {
  editingRecordId = record ? record.id : null;
  $("recordModalTitle").textContent = record ? "Edit record" : "Add record";
  $("recordError").style.display = "none";

  const isDept = scopeType === "department";
  $("categoryField").style.display = isDept ? "block" : "none";
  if (isDept) {
    const cats = DEPARTMENTS[scopeId].categories;
    $("recCategory").innerHTML = cats.map(c => `<option ${record?.category === c ? "selected" : ""}>${c}</option>`).join("");
  }

  $("recTitle").value = record?.title || "";
  $("recDescription").value = record?.description || "";
  $("recStatus").value = record?.status || "Planned";
  $("recDate").value = record?.date || "";

  $("recordModalBackdrop").classList.add("open");

  $("recordForm").onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      scopeType, scopeId,
      category: isDept ? $("recCategory").value : null,
      title: $("recTitle").value.trim(),
      description: $("recDescription").value.trim(),
      status: $("recStatus").value,
      date: $("recDate").value,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };
    try {
      if (editingRecordId) {
        await updateDoc(doc(db, "records", editingRecordId), payload);
      } else {
        await addDoc(collection(db, "records"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: currentUser.email
        });
      }
      closeRecordModal();
    } catch (err) {
      $("recordError").textContent = "Couldn't save: " + err.message;
      $("recordError").style.display = "block";
    }
  };
}

function closeRecordModal() {
  $("recordModalBackdrop").classList.remove("open");
  editingRecordId = null;
}
$("recordCancelBtn").addEventListener("click", closeRecordModal);

/* =========================== CHART OF ACCOUNTS ============================ */

function renderAccounts() {
  const isAdmin = profile.role === "superadmin";
  activeAccountType = "All";

  $("pageTitle").textContent = "Chart of Accounts";
  $("pageCrumb").textContent = isAdmin
    ? "Create and manage the accounts used across EPR"
    : "View the accounts used across EPR (read-only)";
  $("pageActions").innerHTML = isAdmin
    ? `<button class="btn btn-primary" style="width:auto;" id="addAccountBtn">+ Add account</button>`
    : "";
  if (isAdmin) $("addAccountBtn").addEventListener("click", () => openAccountModal());

  const typeChips = ["All", ...Object.keys(ACCOUNT_TYPES)];
  $("content").innerHTML = `
    <div class="chips" id="accountTypeChips" style="margin-bottom:18px;">
      ${typeChips.map(t => `
        <button type="button" class="chip ${t === "All" ? "active" : ""}" data-type="${t}">
          ${t === "All" ? "All" : accountTypeLabel(t)}
        </button>
      `).join("")}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Accounts</h2></div>
      <div class="panel-body" id="accountsBody">
        <div class="empty-state">Loading…</div>
      </div>
    </div>
  `;

  document.querySelectorAll("#accountTypeChips .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      activeAccountType = chip.dataset.type;
      document.querySelectorAll("#accountTypeChips .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      paintAccounts(isAdmin);
    });
  });

  unsubscribeAccounts = onSnapshot(collection(db, "accounts"), (snap) => {
    cachedAccounts = [];
    snap.forEach(d => cachedAccounts.push({ id: d.id, ...d.data() }));
    cachedAccounts.sort((a, b) => (a.code || "").localeCompare(b.code || ""));
    paintAccounts(isAdmin);
  }, (err) => {
    $("accountsBody").innerHTML = `<div class="empty-state">Couldn't load accounts. ${err.message}</div>`;
  });
}

function paintAccounts(isAdmin) {
  const body = $("accountsBody");
  if (!body) return;

  const rows = activeAccountType === "All"
    ? cachedAccounts
    : cachedAccounts.filter(a => a.type === activeAccountType);

  if (rows.length === 0) {
    body.innerHTML = `<div class="empty-state"><div class="big">No accounts yet</div>${
      isAdmin ? "Add your first account using the button above." : "Check back once accounts have been set up."
    }</div>`;
    return;
  }

  body.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Code</th><th>Name</th><th>Type</th><th>Description</th>${isAdmin ? "<th></th>" : ""}
        </tr></thead>
        <tbody>
          ${rows.map(a => `
            <tr>
              <td><strong>${escapeHtml(a.code || "—")}</strong></td>
              <td>${escapeHtml(a.name)}</td>
              <td><span class="tag" style="background:${accountTypeColor(a.type)}22;color:${accountTypeColor(a.type)};border-color:${accountTypeColor(a.type)}55;">${accountTypeLabel(a.type)}</span></td>
              <td>${escapeHtml(a.description || "—")}</td>
              ${isAdmin ? `
                <td class="row-actions">
                  <button class="btn btn-ghost btn-sm" data-edit="${a.id}">Edit</button>
                  <button class="btn btn-danger btn-sm" data-del="${a.id}">Delete</button>
                </td>` : ""}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (!isAdmin) return;

  body.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const acct = cachedAccounts.find(a => a.id === btn.dataset.edit);
      openAccountModal(acct);
    });
  });
  body.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("Delete this account? This cannot be undone.")) {
        await deleteDoc(doc(db, "accounts", btn.dataset.del));
      }
    });
  });
}

function openAccountModal(account = null) {
  editingAccountId = account ? account.id : null;
  $("accountModalTitle").textContent = account ? "Edit account" : "Add account";
  $("accountError").style.display = "none";

  $("acctType").innerHTML = Object.entries(ACCOUNT_TYPES).map(([id, t]) =>
    `<option value="${id}" ${account?.type === id ? "selected" : ""}>${t.label}</option>`
  ).join("");

  $("acctCode").value = account?.code || "";
  $("acctName").value = account?.name || "";
  $("acctDescription").value = account?.description || "";

  $("accountModalBackdrop").classList.add("open");

  $("accountForm").onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      code: $("acctCode").value.trim(),
      name: $("acctName").value.trim(),
      type: $("acctType").value,
      description: $("acctDescription").value.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };
    try {
      if (editingAccountId) {
        await updateDoc(doc(db, "accounts", editingAccountId), payload);
      } else {
        await addDoc(collection(db, "accounts"), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: currentUser.email
        });
      }
      closeAccountModal();
    } catch (err) {
      $("accountError").textContent = "Couldn't save: " + err.message;
      $("accountError").style.display = "block";
    }
  };
}

function closeAccountModal() {
  $("accountModalBackdrop").classList.remove("open");
  editingAccountId = null;
}
$("accountCancelBtn").addEventListener("click", closeAccountModal);

/* ===================== GENERIC FINANCE MODULE ENGINE ====================== */
// Drives Record Expense, Record Income, Customers, Suppliers, Inventory,
// Projects and Make Budget from the MODULES config in structure.js. One
// engine, tailored fields per module — add a module to structure.js and it
// works here with no further code.

function renderModule(moduleId) {
  const cfg = MODULES[moduleId];
  const isEditor = canEditFinance();

  $("pageTitle").textContent = cfg.name;
  $("pageCrumb").textContent = isEditor
    ? "Finance & Administration — add, edit, and manage"
    : "Finance & Administration — view only";
  $("pageActions").innerHTML = isEditor
    ? `<button class="btn btn-primary" style="width:auto;" id="addModuleBtn">+ Add ${cfg.singular}</button>`
    : "";
  if (isEditor) $("addModuleBtn").addEventListener("click", () => openModuleModal(moduleId));

  $("content").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>${cfg.name}</h2></div>
      <div class="panel-body" id="moduleBody"><div class="empty-state">Loading…</div></div>
    </div>
  `;

  unsubscribeModule = onSnapshot(collection(db, cfg.collection), (snap) => {
    cachedModuleRows = [];
    snap.forEach(d => cachedModuleRows.push({ id: d.id, ...d.data() }));
    cachedModuleRows.sort((a, b) => (b.updatedAt?.seconds || b.createdAt?.seconds || 0) - (a.updatedAt?.seconds || a.createdAt?.seconds || 0));
    paintModule(moduleId, isEditor);
  }, (err) => {
    $("moduleBody").innerHTML = `<div class="empty-state">Couldn't load data. ${err.message}</div>`;
  });
}

function paintModule(moduleId, isEditor) {
  const cfg = MODULES[moduleId];
  const body = $("moduleBody");
  if (!body) return;

  if (cachedModuleRows.length === 0) {
    body.innerHTML = `<div class="empty-state"><div class="big">Nothing here yet</div>${
      isEditor ? `Add your first ${cfg.singular} using the button above.` : "Check back later."
    }</div>`;
    return;
  }

  body.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr>
          ${cfg.listColumns.map(key => `<th>${cfg.fields.find(f => f.key === key).label}</th>`).join("")}
          ${isEditor ? "<th></th>" : ""}
        </tr></thead>
        <tbody>
          ${cachedModuleRows.map(row => `
            <tr>
              ${cfg.listColumns.map(key => `<td>${formatModuleCell(cfg, key, row[key])}</td>`).join("")}
              ${isEditor ? `
                <td class="row-actions">
                  <button class="btn btn-ghost btn-sm" data-edit="${row.id}">Edit</button>
                  <button class="btn btn-danger btn-sm" data-del="${row.id}">Delete</button>
                </td>` : ""}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (!isEditor) return;

  body.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = cachedModuleRows.find(r => r.id === btn.dataset.edit);
      openModuleModal(moduleId, row);
    });
  });
  body.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm(`Delete this ${cfg.singular}? This cannot be undone.`)) {
        await deleteDoc(doc(db, cfg.collection, btn.dataset.del));
      }
    });
  });
}

function formatModuleCell(cfg, key, value) {
  const field = cfg.fields.find(f => f.key === key);
  if (value === undefined || value === null || value === "") return "—";
  if (field?.format === "currency") return formatCurrency(value);
  if (field?.badge) return `<span class="tag">${escapeHtml(value)}</span>`;
  return escapeHtml(value);
}

function openModuleModal(moduleId, record = null) {
  const cfg = MODULES[moduleId];
  editingModuleId = record ? record.id : null;

  $("moduleModalTitle").textContent = record ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`;
  $("moduleError").style.display = "none";

  $("moduleFields").innerHTML = cfg.fields.map(f => moduleFieldHtml(f, record?.[f.key])).join("");
  $("moduleModalBackdrop").classList.add("open");

  $("moduleForm").onsubmit = async (e) => {
    e.preventDefault();
    const payload = {};
    for (const f of cfg.fields) {
      const el = $("mf_" + f.key);
      payload[f.key] = f.type === "number" ? (parseFloat(el.value) || 0) : el.value.trim();
    }
    payload.updatedAt = serverTimestamp();
    payload.updatedBy = currentUser.email;

    try {
      if (editingModuleId) {
        await updateDoc(doc(db, cfg.collection, editingModuleId), payload);
      } else {
        await addDoc(collection(db, cfg.collection), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: currentUser.email
        });
      }
      closeModuleModal();
    } catch (err) {
      $("moduleError").textContent = "Couldn't save: " + err.message;
      $("moduleError").style.display = "block";
    }
  };
}

function moduleFieldHtml(f, value) {
  const id = "mf_" + f.key;
  const v = value === undefined || value === null ? "" : value;
  if (f.type === "textarea") {
    return `<div class="field"><label for="${id}">${f.label}</label><textarea id="${id}" rows="3">${escapeHtml(v)}</textarea></div>`;
  }
  if (f.type === "select") {
    return `<div class="field"><label for="${id}">${f.label}</label>
      <select id="${id}" ${f.required ? "required" : ""}>
        <option value="">— Select —</option>
        ${f.options.map(o => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}
      </select></div>`;
  }
  return `<div class="field"><label for="${id}">${f.label}</label>
    <input type="${f.type}" id="${id}" ${f.required ? "required" : ""} ${f.type === "number" ? 'step="any"' : ""} value="${escapeHtml(v)}"></div>`;
}

function closeModuleModal() {
  $("moduleModalBackdrop").classList.remove("open");
  editingModuleId = null;
}
$("moduleCancelBtn").addEventListener("click", closeModuleModal);

/* ========================= INVOICES & BILLS ============================== */
// Shared engine for two collections that both need line items and a
// computed total: "invoice" -> collection "invoices", "bill" -> collection
// "bills". Everything else about them (labels, statuses) is looked up from
// the `kind`.

const DOC_KIND = {
  invoice: {
    collection: "invoices", title: "Invoice", titlePlural: "Invoices",
    partyLabel: "Customer", numberLabel: "Invoice #", statuses: INVOICE_STATUSES
  },
  bill: {
    collection: "bills", title: "Bill", titlePlural: "Bills",
    partyLabel: "Supplier", numberLabel: "Bill #", statuses: BILL_STATUSES
  }
};

function renderDocList(kind) {
  const meta = DOC_KIND[kind];
  const isEditor = canEditFinance();

  $("pageTitle").textContent = meta.titlePlural;
  $("pageCrumb").textContent = isEditor
    ? "Finance & Administration — add, edit, and manage"
    : "Finance & Administration — view only";
  $("pageActions").innerHTML = isEditor
    ? `<button class="btn btn-primary" style="width:auto;" id="addDocBtn">+ New ${meta.title.toLowerCase()}</button>`
    : "";
  if (isEditor) $("addDocBtn").addEventListener("click", () => openDocModal(kind));

  $("content").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>${meta.titlePlural}</h2></div>
      <div class="panel-body" id="docListBody"><div class="empty-state">Loading…</div></div>
    </div>
  `;

  unsubscribeDocs = onSnapshot(collection(db, meta.collection), (snap) => {
    cachedDocs = [];
    snap.forEach(d => cachedDocs.push({ id: d.id, ...d.data() }));
    cachedDocs.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    paintDocList(kind, isEditor);
  }, (err) => {
    $("docListBody").innerHTML = `<div class="empty-state">Couldn't load data. ${err.message}</div>`;
  });
}

function paintDocList(kind, isEditor) {
  const meta = DOC_KIND[kind];
  const body = $("docListBody");
  if (!body) return;

  if (cachedDocs.length === 0) {
    body.innerHTML = `<div class="empty-state"><div class="big">No ${meta.titlePlural.toLowerCase()} yet</div>${
      isEditor ? `Create your first ${meta.title.toLowerCase()} using the button above.` : "Check back later."
    }</div>`;
    return;
  }

  body.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>${meta.numberLabel}</th><th>${meta.partyLabel}</th><th>Date</th><th>Due</th><th>Status</th><th>Total</th>${isEditor ? "<th></th>" : ""}
        </tr></thead>
        <tbody>
          ${cachedDocs.map(d => `
            <tr>
              <td><strong>${escapeHtml(d.number || "—")}</strong></td>
              <td>${escapeHtml(d.party || "—")}</td>
              <td>${d.date || "—"}</td>
              <td>${d.dueDate || "—"}</td>
              <td><span class="tag ${d.status === "Paid" ? "gold" : ""}">${d.status || "—"}</span></td>
              <td>${formatCurrency(d.total)}</td>
              ${isEditor ? `
                <td class="row-actions">
                  <button class="btn btn-ghost btn-sm" data-edit="${d.id}">Edit</button>
                  <button class="btn btn-danger btn-sm" data-del="${d.id}">Delete</button>
                </td>` : ""}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (!isEditor) return;

  body.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const d = cachedDocs.find(r => r.id === btn.dataset.edit);
      openDocModal(kind, d);
    });
  });
  body.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm(`Delete this ${meta.title.toLowerCase()}? This cannot be undone.`)) {
        await deleteDoc(doc(db, meta.collection, btn.dataset.del));
      }
    });
  });
}

function openDocModal(kind, record = null) {
  const meta = DOC_KIND[kind];
  editingDocId = record ? record.id : null;

  $("docModalTitle").textContent = record ? `Edit ${meta.title.toLowerCase()}` : `New ${meta.title.toLowerCase()}`;
  $("docError").style.display = "none";
  $("docPartyLabel").textContent = meta.partyLabel;
  $("docNumberLabel").textContent = meta.numberLabel;
  $("docStatus").innerHTML = meta.statuses.map(s => `<option ${record?.status === s ? "selected" : ""}>${s}</option>`).join("");

  $("docParty").value = record?.party || "";
  $("docNumber").value = record?.number || "";
  $("docDate").value = record?.date || "";
  $("docDueDate").value = record?.dueDate || "";
  $("docNotes").value = record?.notes || "";

  $("docItemsRows").innerHTML = "";
  const items = (record?.items && record.items.length > 0) ? record.items : [{ description: "", qty: 1, unitPrice: 0 }];
  items.forEach(addDocItemRow);
  recalcDocTotal();

  $("docModalBackdrop").classList.add("open");

  $("docAddItemBtn").onclick = () => addDocItemRow();

  $("docForm").onsubmit = async (e) => {
    e.preventDefault();
    const items = collectDocItems();
    if (items.length === 0) {
      $("docError").textContent = "Add at least one line item.";
      $("docError").style.display = "block";
      return;
    }
    const total = items.reduce((sum, it) => sum + (it.qty * it.unitPrice), 0);

    const payload = {
      party: $("docParty").value.trim(),
      number: $("docNumber").value.trim(),
      date: $("docDate").value,
      dueDate: $("docDueDate").value,
      status: $("docStatus").value,
      notes: $("docNotes").value.trim(),
      items,
      total,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    };

    try {
      if (editingDocId) {
        await updateDoc(doc(db, meta.collection, editingDocId), payload);
      } else {
        await addDoc(collection(db, meta.collection), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: currentUser.email
        });
      }
      closeDocModal();
    } catch (err) {
      $("docError").textContent = "Couldn't save: " + err.message;
      $("docError").style.display = "block";
    }
  };
}

function addDocItemRow(item = { description: "", qty: 1, unitPrice: 0 }) {
  const row = document.createElement("div");
  row.className = "doc-item-row";
  row.style.cssText = "display:flex;gap:8px;margin-bottom:8px;align-items:center;";
  row.innerHTML = `
    <input type="text" placeholder="Description" class="doc-item-desc" style="flex:3;" value="${escapeHtml(item.description || "")}">
    <input type="number" step="any" min="0" placeholder="Qty" class="doc-item-qty" style="flex:1;" value="${item.qty ?? 1}">
    <input type="number" step="any" min="0" placeholder="Unit price" class="doc-item-price" style="flex:1;" value="${item.unitPrice ?? 0}">
    <span class="doc-item-line-total" style="flex:1;font-size:13px;color:var(--ink-soft);white-space:nowrap;"></span>
    <button type="button" class="btn btn-danger btn-sm doc-item-remove" style="width:auto;">✕</button>
  `;
  $("docItemsRows").appendChild(row);

  const recalc = () => recalcDocTotal();
  row.querySelector(".doc-item-desc").addEventListener("input", recalc);
  row.querySelector(".doc-item-qty").addEventListener("input", recalc);
  row.querySelector(".doc-item-price").addEventListener("input", recalc);
  row.querySelector(".doc-item-remove").addEventListener("click", () => {
    row.remove();
    recalcDocTotal();
  });

  recalcDocTotal();
}

function collectDocItems() {
  const items = [];
  document.querySelectorAll("#docItemsRows .doc-item-row").forEach(row => {
    const description = row.querySelector(".doc-item-desc").value.trim();
    const qty = parseFloat(row.querySelector(".doc-item-qty").value) || 0;
    const unitPrice = parseFloat(row.querySelector(".doc-item-price").value) || 0;
    if (description || qty || unitPrice) items.push({ description, qty, unitPrice });
  });
  return items;
}

function recalcDocTotal() {
  let total = 0;
  document.querySelectorAll("#docItemsRows .doc-item-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".doc-item-qty").value) || 0;
    const unitPrice = parseFloat(row.querySelector(".doc-item-price").value) || 0;
    const lineTotal = qty * unitPrice;
    row.querySelector(".doc-item-line-total").textContent = formatCurrency(lineTotal);
    total += lineTotal;
  });
  if ($("docTotalDisplay")) $("docTotalDisplay").textContent = formatCurrency(total);
}

function closeDocModal() {
  $("docModalBackdrop").classList.remove("open");
  editingDocId = null;
}
$("docCancelBtn").addEventListener("click", closeDocModal);

/* =========================== FINANCIAL STATEMENTS ========================= */
// A read-only, computed Income Statement pulling from Record Income,
// Record Expense, paid Invoices (revenue) and paid Bills (expenses).
// One-time fetch with a manual Refresh button, rather than four permanent
// live listeners, since this is a summary view rather than a working list.

async function renderFinancials() {
  $("pageTitle").textContent = "Financial Statements";
  $("pageCrumb").textContent = "Computed income statement — Income & paid Invoices vs Expenses & paid Bills";
  $("pageActions").innerHTML = `
    <span style="display:flex;gap:8px;">
      <button class="btn btn-ghost" style="width:auto;" id="refreshFinancialsBtn">↻ Refresh</button>
      <button class="btn btn-primary" style="width:auto;" id="printFinancialsBtn">🖨 Print</button>
    </span>
  `;
  $("printFinancialsBtn").addEventListener("click", () => window.print());
  $("content").innerHTML = `
    <div class="print-header">
      <div class="print-crest">EPR</div>
      <div><h2>Income Statement</h2><div class="crumb" id="finMeta"></div></div>
    </div>
    <div class="stat-grid" id="finSummary"></div>
    <div class="panel">
      <div class="panel-head"><h2>Revenue by category</h2></div>
      <div class="panel-body" id="finRevenueBody"><div class="empty-state">Loading…</div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Expenses by category</h2></div>
      <div class="panel-body" id="finExpenseBody"><div class="empty-state">Loading…</div></div>
    </div>
  `;
  $("refreshFinancialsBtn").addEventListener("click", loadFinancials);
  await loadFinancials();
}

async function loadFinancials() {
  if (!$("finSummary")) return;
  $("finRevenueBody").innerHTML = `<div class="empty-state">Loading…</div>`;
  $("finExpenseBody").innerHTML = `<div class="empty-state">Loading…</div>`;

  const [incomeSnap, expenseSnap, invoiceSnap, billSnap] = await Promise.all([
    getDocs(collection(db, "income")),
    getDocs(collection(db, "expenses")),
    getDocs(collection(db, "invoices")),
    getDocs(collection(db, "bills"))
  ]);

  const revenueByCategory = {};
  let revenueTotal = 0;
  incomeSnap.forEach(d => {
    const r = d.data();
    const cat = r.category || "Uncategorized";
    revenueByCategory[cat] = (revenueByCategory[cat] || 0) + (Number(r.amount) || 0);
    revenueTotal += Number(r.amount) || 0;
  });
  invoiceSnap.forEach(d => {
    const r = d.data();
    if (r.status === "Paid") {
      revenueByCategory["Paid invoices"] = (revenueByCategory["Paid invoices"] || 0) + (Number(r.total) || 0);
      revenueTotal += Number(r.total) || 0;
    }
  });

  const expenseByCategory = {};
  let expenseTotal = 0;
  expenseSnap.forEach(d => {
    const r = d.data();
    const cat = r.category || "Uncategorized";
    expenseByCategory[cat] = (expenseByCategory[cat] || 0) + (Number(r.amount) || 0);
    expenseTotal += Number(r.amount) || 0;
  });
  billSnap.forEach(d => {
    const r = d.data();
    if (r.status === "Paid") {
      expenseByCategory["Paid bills"] = (expenseByCategory["Paid bills"] || 0) + (Number(r.total) || 0);
      expenseTotal += Number(r.total) || 0;
    }
  });

  const net = revenueTotal - expenseTotal;

  $("finMeta").textContent = `All time · Generated ${new Date().toLocaleString()} · By ${profile.name || currentUser.email}`;
  $("finSummary").innerHTML = `
    <div class="stat-card"><div class="label">Total revenue</div><div class="stat-value">${formatCurrency(revenueTotal)}</div></div>
    <div class="stat-card"><div class="label">Total expenses</div><div class="stat-value">${formatCurrency(expenseTotal)}</div></div>
    <div class="stat-card"><div class="label">${net >= 0 ? "Net surplus" : "Net deficit"}</div><div class="stat-value">${formatCurrency(Math.abs(net))}</div></div>
  `;

  $("finRevenueBody").innerHTML = categoryTableHtml(revenueByCategory, revenueTotal);
  $("finExpenseBody").innerHTML = categoryTableHtml(expenseByCategory, expenseTotal);
}

function categoryTableHtml(byCategory, total) {
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return `<div class="empty-state">No data yet.</div>`;
  return `
    <div class="table-scroll">
      <table>
        <thead><tr><th>Category</th><th>Amount</th><th>% of total</th></tr></thead>
        <tbody>
          ${entries.map(([cat, amt]) => `
            <tr>
              <td>${escapeHtml(cat)}</td>
              <td>${formatCurrency(amt)}</td>
              <td>${total > 0 ? ((amt / total) * 100).toFixed(1) : "0.0"}%</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* ============================ MANAGE USERS =============================== */

function renderUsers() {
  $("pageTitle").textContent = "Manage staff accounts";
  $("pageCrumb").textContent = "Create accounts and assign each person to one department or presbytery";
  $("pageActions").innerHTML = `<button class="btn btn-primary" style="width:auto;" id="addUserBtn">+ Add staff account</button>`;
  $("addUserBtn").addEventListener("click", () => openUserModal());

  $("content").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>All accounts</h2></div>
      <div class="panel-body" id="usersBody"><div class="empty-state">Loading…</div></div>
    </div>
  `;

  unsubscribeUsers = onSnapshot(collection(db, "users"), (snap) => {
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    paintUsers(rows);
  });
}

function paintUsers(rows) {
  const body = $("usersBody");
  if (rows.length === 0) {
    body.innerHTML = `<div class="empty-state">No staff accounts yet.</div>`;
    return;
  }
  body.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Assigned to</th><th></th></tr></thead>
        <tbody>
          ${rows.map(u => `
            <tr>
              <td><strong>${escapeHtml(u.name || "—")}</strong></td>
              <td>${escapeHtml(u.email || "—")}</td>
              <td><span class="badge-role ${u.role === "superadmin" ? "super" : ""}">${u.role === "superadmin" ? "Super Admin" : "Staff"}</span></td>
              <td>${u.role === "superadmin" ? "All departments" : scopeLabel(u.scopeType, u.scopeId)}</td>
              <td class="row-actions">
                <button class="btn btn-ghost btn-sm" data-edit="${u.id}">Edit</button>
                ${u.id !== currentUser.uid ? `<button class="btn btn-danger btn-sm" data-del="${u.id}">Revoke</button>` : ""}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  body.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const u = rows.find(r => r.id === btn.dataset.edit);
      openUserModal(u);
    });
  });
  body.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("Revoke this person's access? Their login will stop working immediately. (Their sign-in credentials still exist in Firebase Auth — remove those separately in the Firebase console if needed.)")) {
        await deleteDoc(doc(db, "users", btn.dataset.del));
      }
    });
  });
}

function openUserModal(user = null) {
  editingUserId = user ? user.id : null;
  $("userModalTitle").textContent = user ? "Edit staff account" : "Add staff account";
  $("userError").style.display = "none";

  $("uScope").innerHTML = allScopes().map(s =>
    `<option value="${s.type}:${s.id}" ${user?.scopeType === s.type && user?.scopeId === s.id ? "selected" : ""}>${s.label}</option>`
  ).join("");

  $("uName").value = user?.name || "";
  $("uEmail").value = user?.email || "";
  $("uPassword").value = "";
  $("uRole").value = user?.role || "staff";

  const isEditing = !!user;
  $("uEmailField").style.display = isEditing ? "none" : "block";
  $("uPasswordField").style.display = isEditing ? "none" : "block";
  $("uEmail").required = !isEditing;

  toggleScopeVisibility();
  $("uRole").onchange = toggleScopeVisibility;
  function toggleScopeVisibility() {
    $("uScopeField").style.display = $("uRole").value === "superadmin" ? "none" : "block";
  }

  $("userModalBackdrop").classList.add("open");

  $("userForm").onsubmit = async (e) => {
    e.preventDefault();
    const role = $("uRole").value;
    const [scopeType, scopeId] = role === "superadmin" ? [null, null] : $("uScope").value.split(":");
    const name = $("uName").value.trim();

    try {
      if (isEditing) {
        await updateDoc(doc(db, "users", editingUserId), { name, role, scopeType, scopeId });
      } else {
        const email = $("uEmail").value.trim();
        const password = $("uPassword").value;
        if (password.length < 6) throw new Error("Password must be at least 6 characters.");

        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        await setDoc(doc(db, "users", cred.user.uid), {
          name, email, role, scopeType, scopeId,
          createdAt: serverTimestamp(),
          createdBy: currentUser.email
        });
        await signOut(secondaryAuth);
      }
      closeUserModal();
    } catch (err) {
      const map = {
        "auth/email-already-in-use": "That email already has an account.",
        "auth/invalid-email": "Enter a valid email address.",
        "auth/weak-password": "Password must be at least 6 characters."
      };
      $("userError").textContent = map[err.code] || err.message;
      $("userError").style.display = "block";
    }
  };
}

function closeUserModal() {
  $("userModalBackdrop").classList.remove("open");
  editingUserId = null;
}
$("userCancelBtn").addEventListener("click", closeUserModal);

/* =============================== HELPERS ================================ */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
