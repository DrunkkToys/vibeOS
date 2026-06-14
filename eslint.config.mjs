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
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
      "@stylistic": stylistic,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
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
]
