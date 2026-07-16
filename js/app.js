// js/app.js
import {
  auth, db, secondaryAuth,
  onAuthStateChanged, signOut,
  createUserWithEmailAndPassword,
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  addDoc, collection, query, where, onSnapshot, serverTimestamp
} from "./firebase-config.js";
import { DEPARTMENTS, PRESBYTERIES, allScopes, scopeLabel } from "./structure.js";

let currentUser = null;     // { uid, email }
let profile = null;         // { name, email, role, scopeType, scopeId }
let unsubscribeRecords = null;
let unsubscribeUsers = null;
let cachedRecords = [];
let activeCategory = "All";
let editingRecordId = null;
let editingUserId = null;

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

/* ============================== SIDEBAR ================================ */

function buildSidebar() {
  const nav = $("navList");
  nav.innerHTML = "";

  if (profile.role === "superadmin") {
    nav.appendChild(navItem("Overview", "#/overview"));

    nav.appendChild(sectionLabel("Departments"));
    for (const [id, d] of Object.entries(DEPARTMENTS)) {
      nav.appendChild(navItem(d.name, `#/department/${id}`));
    }

    nav.appendChild(sectionLabel("Presbyteries"));
    for (const [id, p] of Object.entries(PRESBYTERIES)) {
      nav.appendChild(navItem(p.name, `#/presbytery/${id}`));
    }

    nav.appendChild(sectionLabel("Administration"));
    nav.appendChild(navItem("Manage staff accounts", "#/users"));
  } else {
    // A department/presbytery user only ever sees their own scope.
    const label = scopeLabel(profile.scopeType, profile.scopeId);
    nav.appendChild(navItem(label, `#/${profile.scopeType}/${profile.scopeId}`));
  }
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

  // Guard: staff can only ever view their own assigned scope.
  if (profile.role !== "superadmin") {
    if (scopeType !== profile.scopeType || scopeId !== profile.scopeId) {
      location.hash = `#/${profile.scopeType}/${profile.scopeId}`;
      return;
    }
  }

  if (scopeType === "overview" && profile.role === "superadmin") {
    renderOverview();
  } else if (scopeType === "users" && profile.role === "superadmin") {
    renderUsers();
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
        </div>
      </div>
    </div>
  `;

  // Live count per scope, superadmin can read everything.
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
  $("pageActions").innerHTML = `<button class="btn btn-primary" style="width:auto;" id="addRecordBtn">+ Add record</button>`;
  $("addRecordBtn").addEventListener("click", () => openRecordModal(scopeType, scopeId));

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

  // Editing an existing account: email/password are fixed in Firebase Auth,
  // only role/scope/name can change from this screen.
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

        // Created through the secondary app instance so the Super Admin's
        // own session in the primary app is not replaced.
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