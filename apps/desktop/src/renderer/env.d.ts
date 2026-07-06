/// <reference types="vite/client" />

/**
 * Monaco ships its ESM entry points via a bare `"./*": "./*"` wildcard export
 * (no per-subpath `types` condition), which TypeScript's `bundler` resolution
 * cannot resolve on its own. We import the minimal `editor.api` core (not the
 * `editor.main` bundle, which drags in every language) plus two Monarch
 * language contributions at runtime — Vite/esbuild resolve those file paths
 * directly. These shims just give the type-checker the same shapes, sourced
 * from the package's real root-entry types (`editor.main.d.ts`).
 */
declare module "monaco-editor/esm/vs/editor/editor.api" {
  export * from "monaco-editor";
}
declare module "monaco-editor/esm/vs/basic-languages/python/python.contribution";
declare module "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";

interface Window {
  MonacoEnvironment?: import("monaco-editor").Environment;
}
