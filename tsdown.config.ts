import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  treeshake: {
    moduleSideEffects: true, // Preserve top-level side effects (CLI bootstrap)
  },
  dts: false,
  minify: {
    codegen: true, // Remove comments and newlines
    compress: true, // Simplify code where possible
    mangle: false, // Keep variable and function names intact
  },
  outExtensions: () => ({ js: ".js" }),
  exports: true,
  failOnWarn: true,
});
