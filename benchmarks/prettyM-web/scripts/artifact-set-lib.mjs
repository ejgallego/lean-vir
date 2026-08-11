import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const legacyPrettyMArtifactFiles = [
  "lean-vir/js/vir-runtime.js",
  "lean-vir/wasm/vir-upstream.wasm",
  "prettyM-vir.irpkg",
  "lean-native/BUILD.json",
  "lean-native/prettyM-browser-adapter.mjs",
  "lean-native/prettyM.wasm",
  "lean-native/prettyM.wasm.json",
  "lean-llvm/README.md",
  "lean-llvm/SHA256SUMS",
  "lean-llvm/emscripten-loader.mjs",
  "lean-llvm/prettyM-emscripten-adapter.mjs",
  "lean-llvm/prettyM.manifest.json",
  "lean-llvm/prettyM.mjs",
  "lean-llvm/prettyM.wasm",
];

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256File(path) {
  return sha256(await readFile(path));
}

export function canonicalJson(value) {
  function normalize(item) {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(item[key])]),
      );
    }
    return item;
  }
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

export function inside(root, path, operation) {
  const target = resolve(root, path);
  const local = relative(root, target);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`refusing to ${operation} outside ${root}: ${target}`);
  }
  return target;
}

export function safeArchivePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`unsafe archive path: ${path}`);
  }
  if (Buffer.byteLength(path) > 100) {
    throw new Error(`archive path exceeds the v1 tar limit: ${path}`);
  }
  return path;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function fileRecord(path) {
  const bytes = await readFile(path);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

export async function fileRecords(root, paths) {
  const records = {};
  for (const path of [...paths].sort()) {
    safeArchivePath(path);
    records[path] = await fileRecord(resolve(root, path));
  }
  return records;
}

export async function validateSeed(seed, config) {
  const paths = Object.values(config.components).flatMap((component) =>
    Object.values(component.files),
  );
  for (const path of paths) {
    const target = resolve(seed, path);
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) {
      throw new Error(`artifact seed is incomplete or unsafe: ${path}`);
    }
  }

  const metadata = {};
  for (const [componentId, component] of Object.entries(config.components)) {
    if (!component.producerManifest) continue;
    const manifestPath = component.files[component.producerManifest];
    const manifest = await readJson(resolve(seed, manifestPath));
    metadata[componentId] = manifest;
    const manifestRoot = dirname(resolve(seed, manifestPath));
    if (component.adapter === "fir-native") {
      const record = await fileRecord(
        inside(
          manifestRoot,
          safeArchivePath(manifest.artifact?.file),
          `verify ${componentId} artifact`,
        ),
      );
      if (
        record.bytes !== manifest.artifact?.bytes ||
        record.sha256 !== manifest.artifact?.sha256
      ) {
        throw new Error(`${componentId} artifact does not match its manifest`);
      }
    } else if (component.adapter === "fir-llvm") {
      for (const artifact of Object.values(manifest.artifacts ?? {})) {
        const record = await fileRecord(
          inside(
            manifestRoot,
            safeArchivePath(artifact.file),
            `verify ${componentId} artifact`,
          ),
        );
        if (
          record.bytes !== artifact.byteLength ||
          record.sha256 !== artifact.sha256
        ) {
          throw new Error(
            `${componentId} artifact does not match its manifest: ${artifact.file}`,
          );
        }
      }
    }
  }
  return metadata;
}

function writeOctal(header, offset, length, value) {
  const digits = Math.max(1, length - 1);
  const text = value.toString(8).padStart(digits, "0");
  if (text.length > digits) throw new Error(`tar integer does not fit: ${value}`);
  header.write(text, offset, digits, "ascii");
  header[offset + length - 1] = 0;
}

function tarHeader(path, size) {
  const header = Buffer.alloc(512);
  header.write(safeArchivePath(path), 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

export async function createTar(root, paths) {
  const chunks = [];
  for (const path of [...paths].sort()) {
    const bytes = await readFile(resolve(root, safeArchivePath(path)));
    chunks.push(tarHeader(path, bytes.length), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function readTarString(header, offset, length) {
  const end = header.indexOf(0, offset);
  return header
    .subarray(offset, end === -1 || end > offset + length ? offset + length : end)
    .toString("utf8");
}

function readTarOctal(header, offset, length) {
  const value = readTarString(header, offset, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new Error("invalid tar octal field");
  return value === "" ? 0 : Number.parseInt(value, 8);
}

export async function extractTar(bytes, destination) {
  let offset = 0;
  const paths = new Set();
  await mkdir(destination, { recursive: true });
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return [...paths].sort();
    const storedChecksum = readTarOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (storedChecksum !== actualChecksum) throw new Error("invalid tar checksum");
    const path = safeArchivePath(readTarString(header, 0, 100));
    if (paths.has(path)) throw new Error(`duplicate archive member: ${path}`);
    const type = header[156];
    if (type !== 0 && type !== "0".charCodeAt(0)) {
      throw new Error(`unsupported archive member type for ${path}`);
    }
    const size = readTarOctal(header, 124, 12);
    const start = offset + 512;
    const end = start + size;
    if (end > bytes.length) throw new Error(`truncated archive member: ${path}`);
    const target = inside(destination, path, "extract");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes.subarray(start, end), { mode: 0o644 });
    paths.add(path);
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error("archive is missing its end marker");
}

export async function verifyArtifactSet(directory, lock = null) {
  const manifestPath = resolve(directory, "ARTIFACT_SET.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const legacy =
    manifest.schemaVersion === 1 && manifest.kind === "prettyM-artifact-set";
  const current =
    manifest.schemaVersion === 2 &&
    manifest.kind === "browser-benchmarks/artifact-set";
  if (!legacy && !current) {
    throw new Error("unsupported artifact-set manifest");
  }
  if (lock && manifest.setId !== lock.setId) {
    throw new Error(`artifact set ID mismatch: ${manifest.setId}`);
  }
  if (lock && sha256(manifestBytes) !== lock.manifestSha256) {
    throw new Error("artifact-set manifest digest mismatch");
  }

  const expectedPaths = new Set([
    "ARTIFACT_SET.json",
    "SHA256SUMS",
    ...Object.keys(manifest.files ?? {}),
  ]);
  const actualPaths = [];
  async function visit(path, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const local = prefix ? `${prefix}/${entry.name}` : entry.name;
      safeArchivePath(local);
      if (entry.isDirectory()) await visit(resolve(path, entry.name), local);
      else if (entry.isFile()) actualPaths.push(local);
      else throw new Error(`artifact-set member is not a regular file: ${local}`);
    }
  }
  await visit(directory);
  for (const path of actualPaths) {
    if (!expectedPaths.has(path)) {
      throw new Error(`artifact set contains an unexpected member: ${path}`);
    }
  }
  for (const path of expectedPaths) {
    if (!actualPaths.includes(path)) {
      throw new Error(`artifact set is missing a declared member: ${path}`);
    }
  }

  for (const [path, expected] of Object.entries(manifest.files ?? {})) {
    const target = inside(directory, safeArchivePath(path), "verify");
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) {
      throw new Error(`artifact-set member is missing or unsafe: ${path}`);
    }
    const actual = await fileRecord(target);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new Error(`artifact-set member digest mismatch: ${path}`);
    }
  }
  if (legacy) {
    for (const path of legacyPrettyMArtifactFiles) {
      if (!manifest.files?.[path])
        throw new Error(`manifest omits required file: ${path}`);
    }
  } else if (
    typeof manifest.example?.id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.example.id) ||
    Object.keys(manifest.files ?? {}).length === 0
  ) {
    throw new Error("artifact-set manifest omits its example or files");
  } else if (
    Object.keys(manifest.files).some(
      (path) => !path.startsWith(`${manifest.example.id}/`),
    )
  ) {
    throw new Error(
      `artifact-set files must use the ${manifest.example.id}/ namespace`,
    );
  }

  const checksummedPaths = [
    "ARTIFACT_SET.json",
    ...Object.keys(manifest.files ?? {}),
  ].sort();
  const checksumBody = `${(
    await Promise.all(
      checksummedPaths.map(async (path) =>
        `${await sha256File(resolve(directory, path))}  ${path}`,
      ),
    )
  ).join("\n")}\n`;
  if ((await readFile(resolve(directory, "SHA256SUMS"), "utf8")) !== checksumBody) {
    throw new Error("artifact-set SHA256SUMS does not match its members");
  }
  return manifest;
}

export async function installDirectoryIfAbsent(source, destination) {
  const existing = await stat(destination).catch(() => null);
  if (existing) {
    await rm(source, { recursive: true, force: true });
    return false;
  }
  await mkdir(dirname(destination), { recursive: true });
  await rename(source, destination);
  return true;
}

export async function replaceDirectoryAtomically(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const previous = `${destination}.previous`;
  await rm(previous, { recursive: true, force: true });
  const existing = await stat(destination).catch(() => null);
  if (existing) await rename(destination, previous);
  try {
    await rename(source, destination);
  } catch (error) {
    if (existing) await rename(previous, destination);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}
