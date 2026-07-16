// OPTIONAL — requires Node.js + firebase-admin + a service-account.json key.
// You do NOT need this to run the EPR web app. It's just a bulk-creation
// helper. If you'd rather avoid Node.js entirely, see README.md for how to
// create the first Super Admin by hand in the Firebase Console instead.

import admin from "firebase-admin";
import { readFileSync } from "fs";

const serviceAccount = JSON.parse(
  readFileSync(new URL("./service-account.json", import.meta.url))
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

// scopeType/scopeId must match an id in js/structure.js (or null/null for superadmin)
const ACCOUNTS = [
  {
    name: "EPR Super Admin",
    email: "admin@epr.rw",
    password: "ChangeMe123!",     // CHANGE THIS before running
    role: "superadmin",
    scopeType: null,
    scopeId: null
  },
  {
    name: "Church Growth Officer",
    email: "churchgrowth@epr.rw",
    password: "ChangeMe123!",     // CHANGE THIS before running
    role: "staff",
    scopeType: "department",
    scopeId: "church_growth"
  },
  {
    name: "Kigali Presbytery Clerk",
    email: "kigali@epr.rw",
    password: "ChangeMe123!",     // CHANGE THIS before running
    role: "staff",
    scopeType: "presbytery",
    scopeId: "kigali"
  }
];

async function seed() {
  for (const acc of ACCOUNTS) {
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(acc.email);
      console.log(`Auth user already exists for ${acc.email}, reusing uid ${userRecord.uid}`);
    } catch {
      userRecord = await auth.createUser({
        email: acc.email,
        password: acc.password,
        displayName: acc.name
      });
      console.log(`Created Auth user for ${acc.email} (uid ${userRecord.uid})`);
    }

    await db.collection("users").doc(userRecord.uid).set({
      name: acc.name,
      email: acc.email,
      role: acc.role,
      scopeType: acc.scopeType,
      scopeId: acc.scopeId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: "seed-script"
    }, { merge: true });

    console.log(`Firestore profile written for ${acc.email}\n`);
  }

  console.log("Done. You can now sign in at index.html with any of the emails/passwords above.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});