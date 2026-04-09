import { mkdir } from "fs/promises";
import path from "path";
import esbuild from "esbuild";

const outdir = path.resolve("dist/browser");

await mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [path.resolve("src/browser/mermaid-converter.ts")],
  outfile: path.resolve(outdir, "mermaid-converter.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: false,
  minify: false,
  banner: {
    js: "window.__processShim = window.__processShim || { env: {} };",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
    process: "window.__processShim",
    global: "window",
  },
  logLevel: "info",
});
