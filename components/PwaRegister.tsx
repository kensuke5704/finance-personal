"use client";

import { useEffect } from "react";

const SERVICE_WORKER_VERSION = "1";

export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
    let reloadingForUpdate = false;

    const applyUpdatedWorker = () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    };

    const checkForUpdate = async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          `${basePath}/sw.js?v=${SERVICE_WORKER_VERSION}`,
          { updateViaCache: "none" },
        );
        await registration.update();
      } catch (error) {
        console.error("Service worker registration failed:", error);
      }
    };

    void checkForUpdate();
    navigator.serviceWorker.addEventListener("controllerchange", applyUpdatedWorker);

    const updateWhenVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    document.addEventListener("visibilitychange", updateWhenVisible);
    window.addEventListener("focus", checkForUpdate);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", applyUpdatedWorker);
      document.removeEventListener("visibilitychange", updateWhenVisible);
      window.removeEventListener("focus", checkForUpdate);
    };
  }, []);

  return null;
}
