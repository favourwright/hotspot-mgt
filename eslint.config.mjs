import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      /**
       * Pinned, not `"detect"`, and that is what makes `npm run lint` run at
       * all on this project.
       *
       * `eslint-config-next` ships `settings.react.version: "detect"`, and
       * the `eslint-plugin-react` nested under it (7.37.5) implements that
       * by calling `context.getFilename()`, which ESLint 10 removed. Every
       * file then failed before a single rule ran:
       *
       *   TypeError: Error while loading rule 'react/display-name':
       *   contextOrFilename.getFilename is not a function
       *
       * An explicit version short-circuits `detectReactVersion` entirely -
       * `getReactVersionFromContext` only calls it when the setting says
       * "detect" - so the broken path is never reached. The detection it
       * replaces would have resolved `react` from disk and found exactly
       * this number anyway.
       *
       * Keep this in step with the `react` dependency in package.json on a
       * major upgrade. It only selects which version-gated React rules
       * apply, so being a patch release behind changes nothing; being a
       * major behind would quietly stop flagging things.
       */
      react: { version: "19.2" },
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
