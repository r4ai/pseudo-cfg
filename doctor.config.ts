import { defineConfig } from "react-doctor/api";

export default defineConfig({
  ignore: {
    // Vendored shadcn/ui components; they are updated through the shadcn CLI, not edited by hand.
    files: ["src/components/ui/**"],
    overrides: [
      {
        // The editor modules are only reached through the `lazy()` boundary in lazy-workspace.tsx,
        // so CodeMirror is already split out of the initial bundle.
        files: ["src/features/editor/**"],
        rules: ["react-doctor/prefer-dynamic-import"],
      },
    ],
  },
});
