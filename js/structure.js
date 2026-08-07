// js/structure.js
// This is the single source of truth for the EPR org chart AND for the
// tailored field definitions used by every finance module (Invoices, Bills,
// Record Expense, Record Income, Customers, Suppliers, Inventory, Projects,
// Make Budget). Add/rename anything here and the whole app updates.

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
// Accounts screen.
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

export function categoriesFor(scopeType, scopeId) {
  if (scopeType === "department") return DEPARTMENTS[scopeId]?.categories || [];
  return [];
}

/* ============================================================================
   FINANCE MODULES
   Each entry describes one generic CRUD module: its Firestore collection,
   its singular/plural labels, and the tailored fields shown in its form.
   The generic engine in app.js (renderModule / openModuleModal) reads this
   config to build the table and the add/edit form automatically — add a
   field here and it appears in the UI with no other code changes.

   Field "type": text | email | number | date | textarea | select
   Field "format": "currency" (renders formatted with RWF suffix in tables)
   Field "badge": true (renders as a colored tag in the table, for statuses)
   ============================================================================ */

export const MODULES = {
  expenses: {
    name: "Record Expense",
    singular: "expense",
    collection: "expenses",
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "vendor", label: "Paid to (vendor)", type: "text", required: true },
      {
        key: "category", label: "Expense category", type: "select", required: true,
        options: ["Functioning", "Information", "Project", "Salaries", "Utilities", "Transport", "Maintenance", "Other"]
      },
      {
        key: "paymentMethod", label: "Payment method", type: "select",
        options: ["Cash", "Bank Transfer", "Mobile Money", "Cheque"]
      },
      { key: "amount", label: "Amount (RWF)", type: "number", required: true, format: "currency" },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    listColumns: ["date", "vendor", "category", "paymentMethod", "amount"]
  },

  income: {
    name: "Record Income",
    singular: "income record",
    collection: "income",
    fields: [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "source", label: "Received from", type: "text", required: true },
      {
        key: "category", label: "Income category", type: "select", required: true,
        options: ["Tithe", "Offering", "Donation", "Grant", "Project Income", "Interest", "Other"]
      },
      {
        key: "paymentMethod", label: "Payment method", type: "select",
        options: ["Cash", "Bank Transfer", "Mobile Money", "Cheque"]
      },
      { key: "amount", label: "Amount (RWF)", type: "number", required: true, format: "currency" },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    listColumns: ["date", "source", "category", "paymentMethod", "amount"]
  },

  customers: {
    name: "Customers",
    singular: "customer",
    collection: "customers",
    fields: [
      { key: "name", label: "Customer name", type: "text", required: true },
      { key: "contactPerson", label: "Contact person", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "address", label: "Address", type: "text" },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    listColumns: ["name", "contactPerson", "phone", "email"]
  },

  suppliers: {
    name: "Suppliers",
    singular: "supplier",
    collection: "suppliers",
    fields: [
      { key: "name", label: "Supplier name", type: "text", required: true },
      { key: "contactPerson", label: "Contact person", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "address", label: "Address", type: "text" },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    listColumns: ["name", "contactPerson", "phone", "email"]
  },

  inventory: {
    name: "Inventory",
    singular: "inventory item",
    collection: "inventory",
    fields: [
      { key: "itemName", label: "Item name", type: "text", required: true },
      { key: "sku", label: "SKU / code", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "quantity", label: "Quantity on hand", type: "number", required: true },
      { key: "unitPrice", label: "Unit price (RWF)", type: "number", required: true, format: "currency" },
      { key: "location", label: "Storage location", type: "text" },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    listColumns: ["itemName", "sku", "quantity", "unitPrice"]
  },

  projects: {
    name: "Projects",
    singular: "project",
    collection: "projects",
    fields: [
      { key: "name", label: "Project name", type: "text", required: true },
      { key: "manager", label: "Project manager", type: "text" },
      {
        key: "status", label: "Status", type: "select", badge: true,
        options: ["Planned", "Ongoing", "Completed", "On Hold"]
      },
      { key: "budget", label: "Budget (RWF)", type: "number", format: "currency" },
      { key: "startDate", label: "Start date", type: "date" },
      { key: "endDate", label: "End date", type: "date" },
      { key: "description", label: "Description", type: "textarea" }
    ],
    listColumns: ["name", "manager", "status", "budget"]
  },

  budgets: {
    name: "Make Budget",
    singular: "budget line",
    collection: "budgets",
    fields: [
      { key: "period", label: "Period (e.g. 2026 or Q1 2026)", type: "text", required: true },
      { key: "category", label: "Budget category", type: "text", required: true },
      { key: "plannedAmount", label: "Planned amount (RWF)", type: "number", required: true, format: "currency" },
      { key: "actualAmount", label: "Actual amount so far (RWF)", type: "number", format: "currency" },
      { key: "notes", label: "Notes", type: "textarea" }
    ],
    listColumns: ["period", "category", "plannedAmount", "actualAmount"]
  }
};

export function formatCurrency(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " RWF";
}

export const INVOICE_STATUSES = ["Draft", "Sent", "Paid", "Overdue"];
export const BILL_STATUSES = ["Unpaid", "Paid", "Overdue"];
