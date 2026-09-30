/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory } from "./vir-runtime.js";
import { validateIrPackageSetMembers } from "./runtime/ir-package.js";
import { requireSha256, sha256Hex, validateEnvelope } from "./resources/descriptor.js";
import { resolveProgramExports } from "./resources/program-exports.js";
import { assertResourceCompatibility } from "./resources/compatibility.js";

const manifestLimit = 4 * 1024 * 1024 + 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

function requireManifestUrl(value) {
  if (
    !(value instanceof URL) ||
    !["http:", "https:"].includes(value.protocol) ||
    value.origin !== new URL(import.meta.url).origin ||
    value.username ||
    value.password ||
    value.search ||
    value.hash
  ) {
    throw new TypeError(
      "resource manifests require explicit same-origin HTTP(S) URLs without credentials, query or fragment",
    );
  }
  return new URL(value.href);
}

// Reject duplicates before JSON.parse discards them. This is a bounded lexical
// preflight, not a second JSON grammar: JSON.parse still checks complete syntax.
function parseJson(bytes, label) {
  if (bytes.length > manifestLimit)
    throw new Error(`${label}: manifest too large`);
  const text = decoder.decode(bytes);
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === '"') break;
      }
      const frame = stack.at(-1);
      if (frame?.key) {
        const key = JSON.parse(text.slice(start, i + 1));
        if (frame.keys.has(key))
          throw new Error(`${label}: duplicate JSON key ${key}`);
        frame.keys.add(key);
        frame.key = false;
      }
    } else if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? { keys: new Set(), key: true } : null);
      if (stack.length > 16) throw new Error(`${label}: JSON nesting limit`);
    } else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === "," && stack.at(-1)) stack.at(-1).key = true;
  }
  return JSON.parse(text);
}

async function fetchBounded(url, limit, signal, mediaType = null) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    cache: "no-cache",
    signal,
  });
  if (!response.ok) throw new Error(`resource ${url}: HTTP ${response.status}`);
  const type = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (mediaType !== null && type !== mediaType) {
    await response.body?.cancel();
    throw new Error(
      `resource ${url}: expected Content-Type ${mediaType}, got ${type}`,
    );
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    throw new Error(`resource ${url}: length exceeds ${limit}`);
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new Error(`resource ${url}: length exceeds ${limit}`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function fetchBundle(url, kind, signal) {
  const envelope = await validateEnvelope(
    parseJson(
      await fetchBounded(url, manifestLimit, signal, "application/json"),
      "resource envelope",
    ),
  );
  if (envelope.descriptor.kind !== kind)
    throw new Error(`expected ${kind} resource bundle`);
  const files = new Map();
  // A small bounded worker pool: do not start thousands of requests at once.
  let next = 0;
  const worker = async () => {
    while (next < envelope.descriptor.files.length) {
      const info = envelope.descriptor.files[next++];
      const fileUrl = new URL(info.path, url);
      const mime =
        info.mediaType === "application/wasm"
          ? "application/wasm"
          : info.mediaType === "text/javascript"
            ? "text/javascript"
            : null;
      const bytes = await fetchBounded(fileUrl, info.byteLength, signal, mime);
      if (
        bytes.length !== info.byteLength ||
        (await sha256Hex(bytes)) !== info.sha256
      ) {
        throw new Error(`resource integrity mismatch: ${info.path}`);
      }
      files.set(fileUrl.href, bytes);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(4, envelope.descriptor.files.length) },
      worker,
    ),
  );
  const roleUrl = (role) => {
    const entry = envelope.descriptor.fileEntries.find(
      (item) => item.role === role,
    );
    if (!entry) throw new Error(`missing resource file role ${role}`);
    return new URL(entry.path, url);
  };
  return { ...envelope, files, roleUrl };
}

/**
 * Open one independent Lean program instance. The publisher owns the trusted ESM
 * bootstrap; this function verifies the selected bundle inventories before Lean
 * evaluation. It neither discovers build paths nor starts marked startup hooks.
 */
export async function createProgram(options) {
  if (
    !options ||
    Object.keys(options).sort().join(",") !==
      "programManifestUrl,runtimeManifestUrl"
  ) {
    throw new TypeError(
      "createProgram expects runtimeManifestUrl and programManifestUrl",
    );
  }
  const runtimeUrl = requireManifestUrl(options.runtimeManifestUrl);
  const programUrl = requireManifestUrl(options.programManifestUrl);
  requireSha256();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("resource acquisition timeout")),
    120000,
  );
  let runtime = null;
  try {
    const [engine, program] = await Promise.all([
      fetchBundle(runtimeUrl, "runtime", controller.signal),
      fetchBundle(programUrl, "program", controller.signal),
    ]);
    const compatibility = engine.descriptor.compatibility;
    if (
      JSON.stringify(compatibility) !==
      JSON.stringify(program.descriptor.compatibility)
    ) {
      throw new Error("incompatible runtime and program resource bundles");
    }
    assertResourceCompatibility(compatibility);
    if (engine.descriptor.logicalId === program.descriptor.logicalId) {
      throw new Error(
        "runtime and program resource logical identities conflict",
      );
    }
    if (engine.roleUrl("runtimeModule").href !== import.meta.url) {
      throw new Error(
        "runtimeModule role does not identify the executing resource module",
      );
    }
    const wasmUrl = engine.roleUrl("wasm");
    const wasmInfo = engine.descriptor.files.find(
      (info) => new URL(info.path, runtimeUrl).href === wasmUrl.href,
    );
    if (wasmInfo.mediaType !== "application/wasm")
      throw new Error("wasm role requires application/wasm");
    const setUrl = program.roleUrl("programSet");
    // The existing runtime owns package-set semantics. Restrict its byte reader
    // to the already verified inventory: missing/escaping members never fetch.
    const verifiedBytes = async (url) => {
      const bytes = program.files.get(String(url));
      if (!bytes)
        throw new Error(`program member is outside verified inventory: ${url}`);
      return bytes;
    };
    const factory = createVirRuntimeFactory({
      wasmBytes: engine.files.get(wasmUrl.href),
      fetchBytes: verifiedBytes,
    });
    // Preflight duplicate keys and JSON depth before the existing descriptor parser.
    parseJson(await verifiedBytes(setUrl), "program package-set");
    const packageSet = await factory.fetchIrPackageSet(setUrl);
    const { manifests } = validateIrPackageSetMembers(
      packageSet.members.map((m) => m.bytes),
      {
        members: packageSet.members,
      },
    );
    for (const manifest of manifests) {
      // IR and interface format versions were checked by the package validator.
      if (manifest.metadata.leanGithash !== compatibility.leanRevision) {
        throw new Error(
          "program compiled identity does not match resource compatibility",
        );
      }
    }
    resolveProgramExports(program.descriptor.exports, manifests.at(-1).exports);
    runtime = await factory.createRuntime({ irPackageSet: packageSet });
    // Use the installed entries (including their runtime call-index cache), not
    // structurally equivalent entries parsed during the preflight above.
    const exports = resolveProgramExports(
      program.descriptor.exports,
      runtime.interfaceManifest.exports,
    );
    let disposed = false;
    return Object.freeze({
      get status() {
        return disposed
          ? "disposed"
          : runtime.failure === null ? "active" : "failed";
      },
      call(role, ...args) {
        if (disposed) throw new Error("program has been disposed");
        const entry = exports.get(role);
        if (entry === undefined)
          throw new Error(`unknown program export role ${role}`);
        return runtime.callEntry(entry, args);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        try {
          runtime.dispose();
        } finally {
          // A retained closed facade must not keep the Wasm heap reachable,
          // including when runtime cleanup reports an error.
          runtime = null;
          exports.clear();
        }
      },
    });
  } catch (error) {
    controller.abort(error);
    if (runtime !== null) {
      try {
        runtime.dispose();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "program creation and cleanup failed",
        );
      }
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
