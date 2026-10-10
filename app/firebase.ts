import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDV7v35UOCwRi8hxXPg7u_ijaqFw5phle8",
  authDomain: "finance-55694.firebaseapp.com",
  projectId: "finance-55694",
  storageBucket: "finance-55694.firebasestorage.app",
  messagingSenderId: "189181380819",
  appId: "1:189181380819:web:e9b4a9a7e2800d8fe02c26",
};

const app = getApps().find((candidate) => candidate.name === "finance-personal")
  || initializeApp(firebaseConfig, "finance-personal");

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
export const db = getFirestore(app);
