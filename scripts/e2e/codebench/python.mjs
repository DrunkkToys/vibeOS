// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process"

let _python = null

export function python() {
  if (_python) return _python
  if (process.env.CODEBENCH_PYTHON) return (_python = process.env.CODEBENCH_PYTHON)
  try {
    _python = execFileSync("uv", ["run", "--no-project", "python", "-c", "import sys; print(sys.executable)"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    _python = "python3"
  }
  return _python
}
