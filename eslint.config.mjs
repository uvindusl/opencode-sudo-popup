import eslint from "eslint"
import globals from "globals"

export default [
  {
    files: ["src/**/*.js", "scripts/**/*.js", "test/**/*.js", "eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2022 },
    },
    plugins: {
      eslint,
    },
    rules: {
      "no-console": "warn",
      "no-unused-vars": "warn",
      "no-undef": "error",
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "semi": ["error", "never"],
      "quotes": ["error", "double", { avoidEscape: true }],
      "no-trailing-spaces": "error",
      "eol-last": "error",
    },
  },
]
