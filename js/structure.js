// js/structure.js
// This is the single source of truth for the EPR org chart.
// Add/rename a department or presbytery here and the whole app updates.
export const DEPARTMENTS = {
  church_growth: {
    name: "Department of Church Growth",
    color: "#1D8FE1",
    categories: ["Evangelization", "Youth", "Women and Family", "CFD"]
  },
  development_diakonia: {
    name: "Department of Development and Diakonia",
    color: "#1D8FE1",
    categories: ["Development", "Project SCA", "Project CCDP", "Diakonia"]
  },
  finance_admin: {
    name: "Department of Finance and Administration",
    color: "#1D8FE1",
    categories: ["Functioning", "Information"]
  },
  education: {
    name: "Department of Education",
    color: "#1D8FE1",
    categories: ["Education", "CPAJ"]
  },
  health: {
    name: "Department of Health",
    color: "#1D8FE1",
    categories: ["Health Projects"]
  }
};

export const PRESBYTERIES = {
  zinga: { name: "EPR Presbytery Zinga" },
  kigali: { name: "EPR Presbytery Kigali" },
  remera: { name: "EPR Presbytery Remera" },
  gitarama: { name: "EPR Presbytery Gitarama" },
  rubengera: { name: "EPR Presbytery Rubengera" },
  kirinda: { name: "EPR Presbytery Kirinda" },
  gisenyi: { name: "EPR Presbytery Gisenyi" }
};

// The five standard accounting classifications used by the Chart of
// Accounts screen. Each has a label (shown in the UI) and a color (used for
// the little type badge). Add a new type here and it shows up everywhere —
// the add/edit form, the table badges, and the filter chips.
export const ACCOUNT_TYPES = {
  asset: { label: "Asset", color: "#1D8FE1" },
  liability: { label: "Liability", color: "#D64545" },
  equity: { label: "Equity", color: "#6B4FA0" },
  income: { label: "Income", color: "#1E9E64" },
  expense: { label: "Expense", color: "#C98A1E" }
};

export function accountTypeLabel(type) {
  return ACCOUNT_TYPES[type]?.label || type || "—";
}

export function accountTypeColor(type) {
  return ACCOUNT_TYPES[type]?.color || "#7a8291";
}

// Every scope (department or presbytery) a staff account can be tied to,
// used to populate the "assign role" dropdown in the Manage Users screen.
export function allScopes() {
  const scopes = [];
  for (const [id, d] of Object.entries(DEPARTMENTS)) {
    scopes.push({ type: "department", id, label: d.name });
  }
  for (const [id, p] of Object.entries(PRESBYTERIES)) {
    scopes.push({ type: "presbytery", id, label: p.name });
  }
  return scopes;
}

export function scopeLabel(scopeType, scopeId) {
  if (scopeType === "department") return DEPARTMENTS[scopeId]?.name || scopeId;
  if (scopeType === "presbytery") return PRESBYTERIES[scopeId]?.name || scopeId;
  return "—";
}

// Categories for a given scope. Presbyteries have no sub-categories of their
// own (records are just tagged with the presbytery), departments do.
export function categoriesFor(scopeType, scopeId) {
  if (scopeType === "department") return DEPARTMENTS[scopeId]?.categories || [];
  return [];
}
