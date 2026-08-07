// js/firebase-config.js
// Central Firebase setup. Every other file imports { auth, db, secondaryAuth } from here.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  updatePassword
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCP1G7F_Ho1zBCt44BAH_VHks3bqoAyt9M",
  authDomain: "epr-project-4d133.firebaseapp.com",
  projectId: "epr-project-4d133",
  storageBucket: "epr-project-4d133.firebasestorage.app",
  messagingSenderId: "504873971997",
  appId: "1:504873971997:web:790cf33ba359db6adc31f4"
};

// Primary app: the session the logged-in person actually uses.
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Secondary app: used ONLY when a Super Admin creates a new staff account.
// Creating a user with the client SDK automatically signs that new user in,
// which would kick the admin out of their own session. Running the create
// call through a second, isolated app instance avoids that side effect.
const secondaryApp = getApps().some(a => a.name === "Secondary")
  ? getApps().find(a => a.name === "Secondary")
  : initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  updatePassword,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
};
