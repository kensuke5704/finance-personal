"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

type PersonalLedger = { selectedMonth: string };
type SyncStatus = "local" | "connecting" | "synced" | "saving" | "error";
const STORAGE_PREFIX = "finance-personal.ledger.v1.";

function cloudRecord<T extends PersonalLedger>(ledger: T) {
  const { selectedMonth: _selectedMonth, ...record } = ledger;
  return JSON.parse(JSON.stringify(record)) as Omit<T, "selectedMonth">;
}

/** Each Google user owns a separate document; the selected month stays on this device. */
export function usePersonalLedger<T extends PersonalLedger>(
  createInitialLedger: () => T,
  restoreLedger: (value: unknown) => T | null,
) {
  const [ledger, setState] = useState<T>(createInitialLedger);
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [syncError, setSyncError] = useState("");
  const ledgerRef = useRef(ledger);
  const ownerRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const generationRef = useRef(0);
  const dirtyRef = useRef(false);
  const lastCloudSignatureRef = useRef("");
  const cloudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cacheLocal = useCallback((value: T, owner: string) => {
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${owner}`, JSON.stringify(value));
      setSaved(true);
    } catch {
      setSaved(false);
      setSyncError("端末内に保存できませんでした。ブラウザの保存容量を確認してください。");
    }
  }, []);

  const flushCloud = useCallback(async (owner: string, generation: number) => {
    if (!hydratedRef.current || ownerRef.current !== owner || generationRef.current !== generation || !dirtyRef.current) return;
    const record = cloudRecord(ledgerRef.current);
    const signature = JSON.stringify(record);
    setSyncStatus("saving");
    try {
      await setDoc(doc(db, "personalFinance", owner), {
        version: 1, ledger: record, updatedAt: serverTimestamp(),
      });
      if (ownerRef.current !== owner || generationRef.current !== generation) return;
      lastCloudSignatureRef.current = signature;
      dirtyRef.current = JSON.stringify(cloudRecord(ledgerRef.current)) !== signature;
      setSyncStatus(dirtyRef.current ? "saving" : "synced");
      setSyncError("");
    } catch {
      if (ownerRef.current !== owner || generationRef.current !== generation) return;
      setSyncStatus("error");
      setSyncError("クラウドに同期できませんでした。端末内には保存しています。接続を確認して再試行してください。");
    }
  }, []);

  const setLedger = useCallback((update: SetStateAction<T>) => {
    if (!hydratedRef.current) return;
    const current = ledgerRef.current;
    const next = typeof update === "function" ? (update as (value: T) => T)(current) : update;
    ledgerRef.current = next;
    setState(next);
    setSaved(false);
    const owner = ownerRef.current;
    const generation = generationRef.current;
    if (localTimerRef.current) clearTimeout(localTimerRef.current);
    localTimerRef.current = setTimeout(() => cacheLocal(next, owner || "guest"), 150);
    if (!owner) return;
    dirtyRef.current = JSON.stringify(cloudRecord(next)) !== lastCloudSignatureRef.current;
    if (!dirtyRef.current) return;
    setSyncStatus("saving");
    if (cloudTimerRef.current) clearTimeout(cloudTimerRef.current);
    cloudTimerRef.current = setTimeout(() => void flushCloud(owner, generation), 500);
  }, [cacheLocal, flushCloud]);

  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeSnapshot?.();
      if (cloudTimerRef.current) clearTimeout(cloudTimerRef.current);
      if (localTimerRef.current) clearTimeout(localTimerRef.current);
      const generation = ++generationRef.current;
      ownerRef.current = user?.uid || null;
      hydratedRef.current = false;
      dirtyRef.current = false;
      lastCloudSignatureRef.current = "";
      setCloudUser(user);
      setReady(false);
      setSyncError("");
      const initial = createInitialLedger();
      let cached = initial;
      try {
        const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${user?.uid || "guest"}`);
        cached = raw ? restoreLedger(JSON.parse(raw)) || initial : initial;
      } catch { /* A damaged cache never replaces a valid cloud record. */ }
      cached = { ...cached, selectedMonth: initial.selectedMonth };
      ledgerRef.current = cached;
      setState(cached);
      if (!user) {
        hydratedRef.current = true;
        setReady(true);
        setSaved(true);
        setSyncStatus("local");
        return;
      }
      setSyncStatus("connecting");
      unsubscribeSnapshot = onSnapshot(doc(db, "personalFinance", user.uid), (snapshot) => {
        if (generationRef.current !== generation) return;
        if (snapshot.metadata.hasPendingWrites) return;
        if (snapshot.exists()) {
          const restored = restoreLedger({ ...snapshot.data().ledger, selectedMonth: ledgerRef.current.selectedMonth });
          if (!restored) {
            setSyncStatus("error");
            setSyncError("クラウド上のデータを読み取れません。保存済みデータを保護するため、入力を停止しています。");
            return;
          }
          const signature = JSON.stringify(cloudRecord(restored));
          // An older snapshot must not replace an edit still waiting to be saved.
          if (dirtyRef.current && signature !== JSON.stringify(cloudRecord(ledgerRef.current))) return;
          dirtyRef.current = false;
          lastCloudSignatureRef.current = signature;
          ledgerRef.current = restored;
          setState(restored);
          cacheLocal(restored, user.uid);
        } else {
          // A new Google account starts empty, never with another user's local data.
          ledgerRef.current = initial;
          setState(initial);
          cacheLocal(initial, user.uid);
          lastCloudSignatureRef.current = JSON.stringify(cloudRecord(initial));
        }
        hydratedRef.current = true;
        setReady(true);
        setSyncStatus("synced");
        setSyncError("");
      }, () => {
        if (generationRef.current !== generation) return;
        setSyncStatus("error");
        setSyncError("クラウドに接続できません。接続とログインを確認して再試行してください。");
      });
    });
    const flushLocal = () => {
      if (hydratedRef.current) cacheLocal(ledgerRef.current, ownerRef.current || "guest");
    };
    const retry = () => {
      const owner = ownerRef.current;
      if (owner && dirtyRef.current) void flushCloud(owner, generationRef.current);
    };
    window.addEventListener("pagehide", flushLocal);
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      unsubscribeAuth();
      unsubscribeSnapshot?.();
      if (cloudTimerRef.current) clearTimeout(cloudTimerRef.current);
      if (localTimerRef.current) clearTimeout(localTimerRef.current);
      window.removeEventListener("pagehide", flushLocal);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [cacheLocal, createInitialLedger, flushCloud, restoreLedger]);

  const signInForSync = async () => {
    setSyncStatus("connecting");
    setSyncError("");
    try { await signInWithPopup(auth, googleProvider); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      console.warn("Google sign-in failed", code);
      setSyncStatus("error");
      setSyncError(code === "auth/unauthorized-domain"
        ? "このサイトのGoogleログイン設定を確認してください。"
        : code === "auth/popup-blocked"
          ? "ログイン画面を開けません。ポップアップを許可してもう一度お試しください。"
          : "Googleログインに失敗しました。もう一度お試しください。");
    }
  };

  const signOutFromSync = async () => {
    const owner = ownerRef.current;
    if (owner && dirtyRef.current) {
      await flushCloud(owner, generationRef.current);
      if (dirtyRef.current) return; // Keep the session until unsaved changes are safe.
    }
    cacheLocal(ledgerRef.current, owner || "guest");
    await signOut(auth);
  };

  return { ledger, setLedger, ready, saved, cloudUser, syncStatus, syncError, signInForSync, signOutFromSync };
}
