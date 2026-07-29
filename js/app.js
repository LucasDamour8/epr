// js/app.js
// Main application logic: auth bootstrap, routing, sidebar, and every page.

import {
  auth, db, secondaryAuth,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, updatePassword,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, onSnapshot, serverTimestamp
} from "./firebase-config.js";

import {
  DEPARTMENTS, PRESBYTERIES, ACCOUNT_TYPES,
  allScopes, allScopesWithHeadOffice, scopeLabel, HEAD_OFFICE_SCOPE
} from "./structure.js";

// ---------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------
let currentUser = null;     // Firebase Auth user
let profile = null;         // { name, email, role, scopeType, scopeId }
let unsubscribers = [];     // active onSnapshot listeners, cleared on route change

function clearListeners() {
  unsubscribers.forEach(u => u());
  unsubscribers = [];
}

function isSuperAdmin() {
  return profile?.role === "superadmin";
}

// The scope a STAFF user is locked to. Super Admins have no fixed scope.
function myScope() {
  if (isSuperAdmin()) return null;
  return { type: profile.scopeType, id: profile.scopeId };
}

// Can the current user manage (add/edit/delete) records for this scope?
function canManageScope(scopeType, scopeId) {
  if (isSuperAdmin()) return true;
  return profile?.scopeType === scopeType && profile?.scopeId === scopeId;
}

// ---------------------------------------------------------------------
// AUTH BOOTSTRAP
// ---------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    profile = null;
    // No login form lives in this file — this SPA assumes login.html
    // (or a login route) signs the user in and lands them here.
    window.location.href = "login.html";
    return;
  }
  currentUser = user;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    // Auth account exists but no Firestore profile — can't authorize anything.
    document.getElementById("pageTitle").textContent = "Account not set up";
    document.getElementById("content").innerHTML =
      `<p>Your account has no profile record. Contact a Super Admin.</p>`;
    return;
  }
  profile = snap.data();
  renderShellForUser();
  if (!location.hash) location.hash = "#/dashboard";
  route();
});

window.addEventListener("hashchange", route);

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
});

// ---------------------------------------------------------------------
// SIDEBAR
// ---------------------------------------------------------------------
function navItemsForRole() {
  const items = [
    { route: "#/dashboard", label: "Dashboard", icon: "◆" },
    { route: "#/records", label: isSuperAdmin() ? "Departments & Presbyteries" : "My Records", icon: "▤" },
    { route: "#/reports", label: "Reports", icon: "▦" },
    { route: "#/accounts", label: "Chart of Accounts", icon: "$" }
  ];
  if (isSuperAdmin()) {
    items.push({ route: "#/users", label: "Manage Users", icon: "◎" });
  }
  return items;
}

function renderShellForUser() {
  document.getElementById("whoName").textContent = profile.name || currentUser.email;
  document.getElementById("whoRole").textContent =
    isSuperAdmin() ? "EPR Super Admin" : scopeLabel(profile.scopeType, profile.scopeId);
  document.getElementById("avatarInitial").textContent =
    (profile.name || currentUser.email || "?").trim().charAt(0).toUpperCase();

  const nav = document.getElementById("navList");
  nav.innerHTML = "";
  navItemsForRole().forEach(item => {
    const btn = document.createElement("button");
    btn.className = "nav-item";
    btn.textContent = `${item.icon}  ${item.label}`;
    btn.dataset.route = item.route;
    btn.addEventListener("click", () => { location.hash = item.route; });
    nav.appendChild(btn);
  });
  highlightActiveNav();
}

function highlightActiveNav() {
  document.querySelectorAll("#navList .nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.route === (location.hash || "#/dashboard"));
  });
}

// ---------------------------------------------------------------------
// ROUTER
// ---------------------------------------------------------------------
function route() {
  if (!profile) return;
  clearListeners();
  highlightActiveNav();
  const hash = location.hash || "#/dashboard";

  if (hash.startsWith("#/dashboard")) return renderDashboard();
  if (hash.startsWith("#/records")) return renderRecords();
  if (hash.startsWith("#/reports")) return renderReports();
  if (hash.startsWith("#/accounts")) return renderAccounts();
  if (hash.startsWith("#/users")) {
    if (!isSuperAdmin()) { location.hash = "#/dashboard"; return; }
    return renderUsers();
  }
  location.hash = "#/dashboard";
}

function setPage(title, crumb, actionsHtml = "") {
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageCrumb").textContent = crumb;
  document.getElementById("pageActions").innerHTML = actionsHtml;
}

// ---------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------
function renderDashboard() {
  setPage("Dashboard", isSuperAdmin() ? "EPR — all scopes" : scopeLabel(profile.scopeType, profile.scopeId));
  const content = document.getElementById("content");
  content.innerHTML = `<div class="grid-cards" id="dashCards"><p>Loading…</p></div>`;

  const cardsEl = document.getElementById("dashCards");

  if (isSuperAdmin()) {
    cardsEl.innerHTML = `
      <div class="card"><h3>Departments</h3><p>${Object.keys(DEPARTMENTS).length}</p></div>
      <div class="card"><h3>Presbyteries</h3><p>${Object.keys(PRESBYTERIES).length}</p></div>
      <div class="card" id="dashRecordCount"><h3>Total records</h3><p>…</p></div>
      <div class="card" id="dashAcctCount"><h3>Chart of Accounts</h3><p>…</p></div>
    `;
    const unsubR = onSnapshot(collection(db, "records"), snap => {
      document.querySelector("#dashRecordCount p").textContent = snap.size;
    });
    const unsubA = onSnapshot(collection(db, "accounts"), snap => {
      document.querySelector("#dashAcctCount p").textContent = snap.size;
    });
    unsubscribers.push(unsubR, unsubA);
  } else {
    const scope = myScope();
    cardsEl.innerHTML = `
      <div class="card" id="dashRecordCount"><h3>My records</h3><p>…</p></div>
      <div class="card" id="dashAcctCount"><h3>My Chart of Accounts entries</h3><p>…</p></div>
    `;
    const rq = query(collection(db, "records"), where("scopeType", "==", scope.type), where("scopeId", "==", scope.id));
    const unsubR = onSnapshot(rq, snap => { document.querySelector("#dashRecordCount p").textContent = snap.size; });
    const aq = query(collection(db, "accounts"), where("scopeType", "==", scope.type), where("scopeId", "==", scope.id));
    const unsubA = onSnapshot(aq, snap => { document.querySelector("#dashAcctCount p").textContent = snap.size; });
    unsubscribers.push(unsubR, unsubA);
  }
}

// ---------------------------------------------------------------------
// RECORDS (department / presbytery activity records)
// ---------------------------------------------------------------------
let recordsScope = null; // currently viewed scope { type, id }

function renderRecords() {
  recordsScope = isSuperAdmin() ? recordsScope : myScope();

  setPage("Records", "Activity records", `
    <button class="btn btn-primary" id="addRecordBtn" style="width:auto;">+ Add record</button>
  `);

  const content = document.getElementById("content");
  let scopePicker = "";
  if (isSuperAdmin()) {
    scopePicker = `<div class="field"><label>Scope</label><select id="recordScopePicker"></select></div>`;
  }
  content.innerHTML = `
    ${scopePicker}
    <table class="data-table">
      <thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Date</th><th></th></tr></thead>
      <tbody id="recordsBody"><tr><td colspan="5">Select a scope…</td></tr></tbody>
    </table>
  `;

  if (isSuperAdmin()) {
    const picker = document.getElementById("recordScopePicker");
    allScopes().forEach(s => {
      const opt = document.createElement("option");
      opt.value = `${s.type}:${s.id}`;
      opt.textContent = s.label;
      picker.appendChild(opt);
    });
    if (!recordsScope) recordsScope = { type: allScopes()[0].type, id: allScopes()[0].id };
    picker.value = `${recordsScope.type}:${recordsScope.id}`;
    picker.addEventListener("change", () => {
      const [type, id] = picker.value.split(":");
      recordsScope = { type, id };
      loadRecords();
    });
  }

  document.getElementById("addRecordBtn").addEventListener("click", () => openRecordModal());
  loadRecords();
}

function loadRecords() {
  if (!recordsScope) return;
  const body = document.getElementById("recordsBody");
  const rq = query(
    collection(db, "records"),
    where("scopeType", "==", recordsScope.type),
    where("scopeId", "==", recordsScope.id),
    orderBy("createdAt", "desc")
  );
  const unsub = onSnapshot(rq, snap => {
    if (snap.empty) { body.innerHTML = `<tr><td colspan="5">No records yet.</td></tr>`; return; }
    body.innerHTML = "";
    snap.forEach(d => {
      const r = d.data();
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(r.title)}</td>
        <td>${escapeHtml(r.category || "—")}</td>
        <td><span class="badge">${escapeHtml(r.status || "Planned")}</span></td>
        <td>${escapeHtml(r.date || "—")}</td>
        <td>
          <button class="btn-icon" data-edit="${d.id}">✎</button>
          <button class="btn-icon" data-del="${d.id}">🗑</button>
        </td>`;
      body.appendChild(tr);
    });
    body.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => openRecordModal(b.dataset.edit)));
    body.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => deleteRecord(b.dataset.del)));
  });
  unsubscribers.push(unsub);
}

async function deleteRecord(id) {
  if (!confirm("Delete this record?")) return;
  await deleteDoc(doc(db, "records", id));
}

let editingRecordId = null;

function openRecordModal(id = null) {
  editingRecordId = id;
  document.getElementById("recordError").textContent = "";
  document.getElementById("recordModalTitle").textContent = id ? "Edit record" : "Add record";

  const categorySelect = document.getElementById("recCategory");
  categorySelect.innerHTML = "";
  const categories = recordsScope.type === "department"
    ? (DEPARTMENTS[recordsScope.id]?.categories || [])
    : [];
  if (categories.length) {
    document.getElementById("categoryField").style.display = "";
    categories.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      categorySelect.appendChild(opt);
    });
  } else {
    document.getElementById("categoryField").style.display = "none";
  }

  if (id) {
    getDoc(doc(db, "records", id)).then(snap => {
      const r = snap.data();
      document.getElementById("recTitle").value = r.title || "";
      document.getElementById("recDescription").value = r.description || "";
      document.getElementById("recStatus").value = r.status || "Planned";
      document.getElementById("recDate").value = r.date || "";
      if (categories.length) categorySelect.value = r.category || categories[0];
    });
  } else {
    document.getElementById("recordForm").reset();
  }
  document.getElementById("recordModalBackdrop").classList.add("open");
}

document.getElementById("recordCancelBtn").addEventListener("click", () => {
  document.getElementById("recordModalBackdrop").classList.remove("open");
});

document.getElementById("recordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!canManageScope(recordsScope.type, recordsScope.id)) {
    document.getElementById("recordError").textContent = "You cannot manage this scope.";
    return;
  }
  const payload = {
    scopeType: recordsScope.type,
    scopeId: recordsScope.id,
    category: document.getElementById("categoryField").style.display === "none"
      ? null : document.getElementById("recCategory").value,
    title: document.getElementById("recTitle").value.trim(),
    description: document.getElementById("recDescription").value.trim(),
    status: document.getElementById("recStatus").value,
    date: document.getElementById("recDate").value,
    updatedAt: serverTimestamp()
  };
  try {
    if (editingRecordId) {
      await updateDoc(doc(db, "records", editingRecordId), payload);
    } else {
      payload.createdAt = serverTimestamp();
      payload.createdBy = currentUser.uid;
      await addDoc(collection(db, "records"), payload);
    }
    document.getElementById("recordModalBackdrop").classList.remove("open");
  } catch (err) {
    document.getElementById("recordError").textContent = err.message;
  }
});

// ---------------------------------------------------------------------
// REPORTS (read-only summary, scoped)
// ---------------------------------------------------------------------
function renderReports() {
  setPage("Reports", "Status overview");
  const content = document.getElementById("content");
  content.innerHTML = `<div id="reportBody">Loading…</div>`;

  const scopes = isSuperAdmin() ? allScopes() : [myScope()];
  const rq = isSuperAdmin()
    ? collection(db, "records")
    : query(collection(db, "records"), where("scopeType", "==", scopes[0].type), where("scopeId", "==", scopes[0].id));

  const unsub = onSnapshot(rq, snap => {
    const counts = {};
    scopes.forEach(s => counts[`${s.type}:${s.id}`] = { Planned: 0, Ongoing: 0, Completed: 0 });
    snap.forEach(d => {
      const r = d.data();
      const key = `${r.scopeType}:${r.scopeId}`;
      if (counts[key]) counts[key][r.status || "Planned"]++;
    });
    let html = `<table class="data-table"><thead><tr><th>Scope</th><th>Planned</th><th>Ongoing</th><th>Completed</th></tr></thead><tbody>`;
    scopes.forEach(s => {
      const c = counts[`${s.type}:${s.id}`];
      html += `<tr><td>${scopeLabel(s.type, s.id)}</td><td>${c.Planned}</td><td>${c.Ongoing}</td><td>${c.Completed}</td></tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById("reportBody").innerHTML = html;
  });
  unsubscribers.push(unsub);
}

// ---------------------------------------------------------------------
// CHART OF ACCOUNTS
// Super Admin: full CRUD across every scope, plus bulk import.
// Staff: CRUD limited to their own assigned scope only.
// ---------------------------------------------------------------------
function renderAccounts() {
  const actions = `
    <button class="btn btn-primary" id="addAcctBtn" style="width:auto;">+ Add account</button>
    ${isSuperAdmin() ? `<button class="btn btn-ghost" id="bulkImportBtn" style="width:auto;">⇪ Bulk import</button>` : ""}
  `;
  setPage("Chart of Accounts", isSuperAdmin() ? "All scopes — EPR" : scopeLabel(profile.scopeType, profile.scopeId), actions);

  const content = document.getElementById("content");
  let scopeFilter = "";
  if (isSuperAdmin()) {
    scopeFilter = `<div class="field"><label>Filter by scope</label><select id="acctScopeFilter"><option value="all">All scopes</option></select></div>`;
  }
  content.innerHTML = `
    ${scopeFilter}
    <table class="data-table">
      <thead><tr><th>Account name</th><th>Type</th><th>Scope</th><th></th></tr></thead>
      <tbody id="acctBody"><tr><td colspan="4">Loading…</td></tr></tbody>
    </table>
  `;

  if (isSuperAdmin()) {
    const filter = document.getElementById("acctScopeFilter");
    allScopesWithHeadOffice().forEach(s => {
      const opt = document.createElement("option");
      opt.value = `${s.type}:${s.id}`;
      opt.textContent = s.label;
      filter.appendChild(opt);
    });
    filter.addEventListener("change", () => loadAccounts(filter.value));
  }

  document.getElementById("addAcctBtn").addEventListener("click", () => openAccountModal());
  if (isSuperAdmin()) {
    document.getElementById("bulkImportBtn").addEventListener("click", openBulkImportModal);
  }

  loadAccounts(isSuperAdmin() ? "all" : `${profile.scopeType}:${profile.scopeId}`);
}

function loadAccounts(filterValue) {
  const body = document.getElementById("acctBody");
  let aq;
  if (filterValue === "all") {
    aq = query(collection(db, "accounts"), orderBy("name"));
  } else {
    const [type, id] = filterValue.split(":");
    aq = query(collection(db, "accounts"), where("scopeType", "==", type), where("scopeId", "==", id), orderBy("name"));
  }
  const unsub = onSnapshot(aq, snap => {
    if (snap.empty) { body.innerHTML = `<tr><td colspan="4">No accounts yet.</td></tr>`; return; }
    body.innerHTML = "";
    snap.forEach(d => {
      const a = d.data();
      const mine = canManageScope(a.scopeType, a.scopeId);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.type)}</td>
        <td>${escapeHtml(scopeLabel(a.scopeType, a.scopeId))}</td>
        <td>
          ${mine ? `<button class="btn-icon" data-edit="${d.id}">✎</button>
                    <button class="btn-icon" data-del="${d.id}">🗑</button>` : `<span class="muted">read-only</span>`}
        </td>`;
      body.appendChild(tr);
    });
    body.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => openAccountModal(b.dataset.edit)));
    body.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => deleteAccount(b.dataset.del)));
  });
  unsubscribers.push(unsub);
}

async function deleteAccount(id) {
  const snap = await getDoc(doc(db, "accounts", id));
  const a = snap.data();
  if (!canManageScope(a.scopeType, a.scopeId)) { alert("You cannot manage this scope."); return; }
  if (!confirm("Delete this account?")) return;
  await deleteDoc(doc(db, "accounts", id));
}

let editingAcctId = null;

function openAccountModal(id = null) {
  editingAcctId = id;
  document.getElementById("acctError").textContent = "";
  document.getElementById("acctModalTitle").textContent = id ? "Edit account" : "Add account";

  const typeSelect = document.getElementById("acctType");
  typeSelect.innerHTML = "";
  ACCOUNT_TYPES.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    typeSelect.appendChild(opt);
  });

  const scopeSelect = document.getElementById("acctScope");
  scopeSelect.innerHTML = "";
  if (isSuperAdmin()) {
    allScopesWithHeadOffice().forEach(s => {
      const opt = document.createElement("option");
      opt.value = `${s.type}:${s.id}`;
      opt.textContent = s.label;
      scopeSelect.appendChild(opt);
    });
    scopeSelect.disabled = false;
  } else {
    const opt = document.createElement("option");
    opt.value = `${profile.scopeType}:${profile.scopeId}`;
    opt.textContent = scopeLabel(profile.scopeType, profile.scopeId);
    scopeSelect.appendChild(opt);
    scopeSelect.disabled = true;
  }

  if (id) {
    getDoc(doc(db, "accounts", id)).then(snap => {
      const a = snap.data();
      document.getElementById("acctName").value = a.name || "";
      typeSelect.value = a.type;
      scopeSelect.value = `${a.scopeType}:${a.scopeId}`;
    });
  } else {
    document.getElementById("acctForm").reset();
    typeSelect.value = ACCOUNT_TYPES[0];
    if (!isSuperAdmin()) scopeSelect.value = `${profile.scopeType}:${profile.scopeId}`;
  }
  document.getElementById("acctModalBackdrop").classList.add("open");
}

document.getElementById("acctCancelBtn").addEventListener("click", () => {
  document.getElementById("acctModalBackdrop").classList.remove("open");
});

document.getElementById("acctForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const [scopeType, scopeId] = document.getElementById("acctScope").value.split(":");
  if (!canManageScope(scopeType, scopeId)) {
    document.getElementById("acctError").textContent = "You can only manage accounts in your assigned scope.";
    return;
  }
  const payload = {
    name: document.getElementById("acctName").value.trim(),
    type: document.getElementById("acctType").value,
    scopeType, scopeId,
    updatedAt: serverTimestamp()
  };
  try {
    if (editingAcctId) {
      await updateDoc(doc(db, "accounts", editingAcctId), payload);
    } else {
      payload.createdAt = serverTimestamp();
      payload.createdBy = currentUser.uid;
      await addDoc(collection(db, "accounts"), payload);
    }
    document.getElementById("acctModalBackdrop").classList.remove("open");
  } catch (err) {
    document.getElementById("acctError").textContent = err.message;
  }
});

// --- Bulk import (Super Admin only) ---------------------------------
function openBulkImportModal() {
  document.getElementById("bulkImportError").textContent = "";
  document.getElementById("bulkImportText").value = "";
  const scopeSelect = document.getElementById("bulkImportScope");
  scopeSelect.innerHTML = "";
  allScopesWithHeadOffice().forEach(s => {
    const opt = document.createElement("option");
    opt.value = `${s.type}:${s.id}`;
    opt.textContent = s.label;
    scopeSelect.appendChild(opt);
  });
  document.getElementById("bulkImportModalBackdrop").classList.add("open");
}

document.getElementById("bulkImportCancelBtn").addEventListener("click", () => {
  document.getElementById("bulkImportModalBackdrop").classList.remove("open");
});

document.getElementById("bulkImportForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("bulkImportError");
  errorEl.textContent = "";
  const [scopeType, scopeId] = document.getElementById("bulkImportScope").value.split(":");
  const raw = document.getElementById("bulkImportText").value.trim();
  if (!raw) { errorEl.textContent = "Paste at least one line."; return; }

  // Expected format per line, copied straight from the QuickBooks export:
  //   Account name<TAB or multiple spaces>Account type
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const rows = lines.map(line => {
    const parts = line.split(/\t+| {2,}/).map(p => p.trim()).filter(Boolean);
    const type = parts.length > 1 ? parts[parts.length - 1] : "Other Expense";
    const name = parts.length > 1 ? parts.slice(0, -1).join(" ") : line;
    return { name, type: ACCOUNT_TYPES.includes(type) ? type : "Other Expense" };
  }).filter(r => r.name);

  if (!rows.length) { errorEl.textContent = "Couldn't parse any rows."; return; }

  const submitBtn = document.getElementById("bulkImportSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = `Importing 0 / ${rows.length}…`;
  try {
    let done = 0;
    for (const r of rows) {
      await addDoc(collection(db, "accounts"), {
        name: r.name,
        type: r.type,
        scopeType, scopeId,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
      });
      done++;
      submitBtn.textContent = `Importing ${done} / ${rows.length}…`;
    }
    document.getElementById("bulkImportModalBackdrop").classList.remove("open");
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Import accounts";
  }
});

// ---------------------------------------------------------------------
// MANAGE USERS (Super Admin only)
// ---------------------------------------------------------------------
function renderUsers() {
  setPage("Manage Users", "Staff accounts", `
    <button class="btn btn-primary" id="addUserBtn" style="width:auto;">+ Add staff account</button>
  `);
  const content = document.getElementById("content");
  content.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Scope</th><th></th></tr></thead>
      <tbody id="usersBody"><tr><td colspan="5">Loading…</td></tr></tbody>
    </table>
  `;
  document.getElementById("addUserBtn").addEventListener("click", () => openUserModal());

  const unsub = onSnapshot(collection(db, "users"), snap => {
    if (snap.empty) { document.getElementById("usersBody").innerHTML = `<tr><td colspan="5">No staff yet.</td></tr>`; return; }
    const body = document.getElementById("usersBody");
    body.innerHTML = "";
    snap.forEach(d => {
      const u = d.data();
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${u.role === "superadmin" ? "Super Admin" : "Staff"}</td>
        <td>${u.role === "superadmin" ? "—" : escapeHtml(scopeLabel(u.scopeType, u.scopeId))}</td>
        <td>
          <button class="btn-icon" data-edit="${d.id}">✎</button>
          ${d.id !== currentUser.uid ? `<button class="btn-icon" data-del="${d.id}">🗑</button>` : ""}
        </td>`;
      body.appendChild(tr);
    });
    body.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => openUserModal(b.dataset.edit)));
    body.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => deleteUser(b.dataset.del)));
  });
  unsubscribers.push(unsub);
}

async function deleteUser(uid) {
  if (!confirm("Remove this staff account's profile? (Their sign-in login will still exist until removed in Firebase Auth.)")) return;
  await deleteDoc(doc(db, "users", uid));
}

let editingUserId = null;

function openUserModal(uid = null) {
  editingUserId = uid;
  document.getElementById("userError").textContent = "";
  document.getElementById("userModalTitle").textContent = uid ? "Edit staff account" : "Add staff account";
  document.getElementById("uEmailField").style.display = uid ? "none" : "";
  document.getElementById("uPasswordField").style.display = uid ? "none" : "";

  const scopeSelect = document.getElementById("uScope");
  scopeSelect.innerHTML = "";
  allScopes().forEach(s => {
    const opt = document.createElement("option");
    opt.value = `${s.type}:${s.id}`;
    opt.textContent = s.label;
    scopeSelect.appendChild(opt);
  });

  const roleSelect = document.getElementById("uRole");
  const toggleScopeVisibility = () => {
    document.getElementById("uScopeField").style.display = roleSelect.value === "superadmin" ? "none" : "";
  };
  roleSelect.onchange = toggleScopeVisibility;

  if (uid) {
    getDoc(doc(db, "users", uid)).then(snap => {
      const u = snap.data();
      document.getElementById("uName").value = u.name || "";
      roleSelect.value = u.role;
      if (u.role !== "superadmin") scopeSelect.value = `${u.scopeType}:${u.scopeId}`;
      toggleScopeVisibility();
    });
  } else {
    document.getElementById("userForm").reset();
    toggleScopeVisibility();
  }
  document.getElementById("userModalBackdrop").classList.add("open");
}

document.getElementById("userCancelBtn").addEventListener("click", () => {
  document.getElementById("userModalBackdrop").classList.remove("open");
});

document.getElementById("userForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("userError");
  errorEl.textContent = "";
  const role = document.getElementById("uRole").value;
  const [scopeType, scopeId] = role === "superadmin"
    ? [null, null]
    : document.getElementById("uScope").value.split(":");
  const name = document.getElementById("uName").value.trim();

  try {
    if (editingUserId) {
      await updateDoc(doc(db, "users", editingUserId), { name, role, scopeType, scopeId });
      document.getElementById("userModalBackdrop").classList.remove("open");
      return;
    }
    const email = document.getElementById("uEmail").value.trim();
    const password = document.getElementById("uPassword").value;
    if (!password || password.length < 6) {
      errorEl.textContent = "Temporary password must be at least 6 characters.";
      return;
    }
    // Created through the secondary Firebase app instance so the admin's
    // own session is not replaced by the new user's session.
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      name, email, role, scopeType, scopeId,
      createdAt: serverTimestamp(), createdBy: currentUser.uid
    });
    await signOut(secondaryAuth);
    document.getElementById("userModalBackdrop").classList.remove("open");
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ---------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------
function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
