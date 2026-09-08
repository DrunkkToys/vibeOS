import typescriptParser from "@typescript-eslint/parser"
import typescriptPlugin from "@typescript-eslint/eslint-plugin"
import stylistic from "@stylistic/eslint-plugin"

export default [
  {
    ignores: [
      "dist-ts/**",
      "node_modules/**",
      "src/**/*.js",
      "src/**/tests/**",
      "src/experiments/**",
      "src/dashboard/**",
      "tests/**",
      "scripts/**",
      "plugins/**",
      "bin/**",
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        process: "readonly", console: "readonly", Buffer: "readonly", fetch: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
        setImmediate: "readonly", queueMicrotask: "readonly", structuredClone: "readonly", performance: "readonly",
        URL: "readonly", URLSearchParams: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
        AbortController: "readonly", AbortSignal: "readonly", crypto: "readonly", globalThis: "readonly",
        Response: "readonly", Request: "readonly", RequestInit: "readonly", Headers: "readonly", FormData: "readonly", Blob: "readonly",
        __dirname: "readonly", __filename: "readonly", require: "readonly", module: "readonly", NodeJS: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
      "@stylistic": stylistic,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      "no-undef": "error",
      "no-console": ["error", { allow: ["warn", "error", "debug"] }],
      "@stylistic/semi": ["warn", "never"],
      "@stylistic/quotes": ["warn", "double", { avoidEscape: true, allowTemplateLiterals: true }],
      "@stylistic/indent": ["warn", 2, { SwitchCase: 1 }],
      "@stylistic/comma-dangle": ["warn", "always-multiline"],
      "@stylistic/eol-last": ["warn", "always"],
      "@stylistic/no-trailing-spaces": "warn",
      "@stylistic/no-multiple-empty-lines": ["warn", { max: 1, maxEOF: 0 }],
    },
  },
  {
    files: ["src/lib/dashboard/**/*.ts"],
    languageOptions: {
      globals: {
        window: "readonly", document: "readonly", location: "readonly", navigator: "readonly",
        localStorage: "readonly", sessionStorage: "readonly", EventSource: "readonly",
        WebSocket: "readonly", HTMLElement: "readonly", Element: "readonly", Event: "readonly",
        MouseEvent: "readonly", KeyboardEvent: "readonly", CustomEvent: "readonly",
        requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
      },
    },
  },
]
