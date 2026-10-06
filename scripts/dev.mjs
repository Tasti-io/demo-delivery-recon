#!/usr/bin/env node
// Local preview: serves public/ and routes /api/recon through the same handler
// Vercel will run.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import recon from "../api/recon.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/recon") {
    const shim = {
      setHeader: (k, v) => res.setHeader(k, v),
      status: (c) => ({ end: (b) => { res.statusCode = c; res.end(b); } }),
    };
    return recon({ method: req.method, query: Object.fromEntries(url.searchParams) }, shim);
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  try {
    const content = await readFile(path.join(ROOT, "public", path.normalize(file).replace(/^(\.\.[/\\])+/, "")));
    res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(3040, () => console.log("delivery recon on http://localhost:3040"));
