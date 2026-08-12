const reloadKey = "browser-benchmarks/coi-reload";

async function ensureCrossOriginIsolation() {
  if (globalThis.crossOriginIsolated) {
    sessionStorage.removeItem(reloadKey);
    return;
  }
  if (!globalThis.isSecureContext || !("serviceWorker" in navigator)) {
    throw new Error(
      "browser benchmarks require cross-origin isolation or service-worker support",
    );
  }
  if (sessionStorage.getItem(reloadKey) === "pending") {
    sessionStorage.removeItem(reloadKey);
    throw new Error("failed to establish cross-origin isolation");
  }
  await navigator.serviceWorker.register(
    new URL("../coi-serviceworker.js", import.meta.url),
    {
      scope: new URL("../", import.meta.url).pathname,
      updateViaCache: "none",
    },
  );
  await navigator.serviceWorker.ready;
  sessionStorage.setItem(reloadKey, "pending");
  location.reload();
  await new Promise(() => {});
}

await ensureCrossOriginIsolation();
await import("./app-shell.js");
