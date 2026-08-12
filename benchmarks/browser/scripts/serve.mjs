import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const port = Number(option("--port", process.env.PORT ?? "18334"));
const root = resolve(appRoot, option("--directory", "dist"));
const isolation = !args.includes("--no-isolation");
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://local").pathname,
    );
    const relative = normalize(
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""),
    );
    let file = resolve(join(root, relative));
    if (file !== root && !file.startsWith(root + sep))
      throw new Error("path escapes root");
    let info = await stat(file);
    if (info.isDirectory()) {
      file = resolve(file, "index.html");
      if (!file.startsWith(root + sep)) throw new Error("path escapes root");
      info = await stat(file);
    }
    if (!info.isFile()) throw new Error("not a file");
    const headers = {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-store",
    };
    if (isolation) {
      headers["Cross-Origin-Opener-Policy"] = "same-origin";
      headers["Cross-Origin-Embedder-Policy"] = "require-corp";
      headers["Cross-Origin-Resource-Policy"] = "same-origin";
    }
    response.writeHead(200, headers);
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}`);
});
