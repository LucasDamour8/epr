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

// A pseudo-scope for accounts that belong to EPR Head Office / General ledger
// rather than to one specific department or presbytery (e.g. "E.P.R./GENERAL(EURO)").
export const HEAD_OFFICE_SCOPE = {
  type: "headoffice",
  id: "headoffice",
  label: "EPR Head Office / General"
};

// The account "Type" values used across the EPR Chart of Accounts
// (taken directly from the QuickBooks export). Kept as a flat list so the
// Chart of Accounts form can render a single <select>, grouped visually
// in the UI layer if desired.
export const ACCOUNT_TYPES = [
  "Bank",
  "Accounts Receivable",
  "Other Current Asset",
  "Fixed Asset",
  "Accounts Payable",
  "Other Current Liability",
  "Long Term Liability",
  "Equity",
  "Income",
  "Expense",
  "Other Expense"
];

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

// Same as allScopes() but with the Head Office / General option prepended.
// Used by the Chart of Accounts form, since some accounts aren't tied to a
// specific department or presbytery.
export function allScopesWithHeadOffice() {
  return [HEAD_OFFICE_SCOPE, ...allScopes()];
}

export function scopeLabel(scopeType, scopeId) {
  if (scopeType === "department") return DEPARTMENTS[scopeId]?.name || scopeId;
  if (scopeType === "presbytery") return PRESBYTERIES[scopeId]?.name || scopeId;
  if (scopeType === "headoffice") return HEAD_OFFICE_SCOPE.label;
  return "—";
}
