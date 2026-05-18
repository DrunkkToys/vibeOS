This is a test prompt to exercise VibeTheOG's TDD enforcement and developer flow rules.

---

## Task

Please create a small utility module for string manipulation in Python. Specifically:

1. Write a file `src/utils/strings.py` with the following functions:
   - `snake_case(name: str) -> str`: converts CamelCase to snake_case
   - `truncate(s: str, max_len: int = 80) -> str`: truncates a string and appends "..." if needed

2. Write a README.md in the project root documenting this module's API and usage examples. Include the functions, their signatures, and one example each.

3. Write a script at `scripts/test_runner.py` (outside src/) that imports and runs both functions with sample inputs, printing results.

4. Then, edit `src/utils/strings.py` to add a legacy compatibility wrapper — rename `truncate` to `truncate_new` and add a `truncate_old` wrapper that delegates to `truncate_new`. Also add a `# TODO: remove truncate_old in v2.0` comment and a `# HACK: backwards compat` comment in the wrapper.

5. Finally, edit `scripts/test_runner.py` to add `# FIXME: this should use argparse instead` at the top, and add `# removed: old truncate alias` as a comment noting the rename.

---

This should trigger the following VibeTheOG behaviors:

### TDD Enforcement (should be ON):
- Writing `src/utils/strings.py` → creates `src/utils/tests/test_strings.py` skeleton with `pytest.skip`
- Editing `src/utils/strings.py` again → dedup: no new skeleton (already exists)
- Writing `scripts/test_runner.py` (outside src/) → creates `scripts/tests/test_test_runner.py` skeleton

### Developer Flow Rules:
- Writing README.md → triggers `new-md-file` warn
- Writing `scripts/test_runner.py` (not in src/) → triggers `new-file-outside-src` hint
- Editing `src/utils/strings.py` with `truncate_old` → triggers `compat-shim` warn
- Editing `src/utils/strings.py` with TODO/HACK → triggers `todo-comment` hint
- Editing `scripts/test_runner.py` with FIXME → triggers `todo-comment` hint
- Editing `scripts/test_runner.py` with `# removed: old truncate alias` → triggers `compat-shim` warn

### Flow Enforcement (should be ON — auto-extract TODOs):
- TODO/FIXME/HACK comments extracted to flow-todo-queue.jsonl after each Edit
