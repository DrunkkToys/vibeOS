# theSaver Codex Plugin

This plugin adds a Codex-native companion layer for `theSaver` with:

- Plugin manifest (`.codex-plugin/plugin.json`)
- Hook scripts (`hooks/`)
- Reusable script entrypoint (`scripts/run-guard.sh`)
- Skill prompt for consistent behavior (`skills/thesaver-guard/SKILL.md`)

## Layout

- `hooks/pre-commit.sh`: runs lightweight validation before commit
- `hooks/post-command-summary.sh`: records a short operation summary
- `scripts/run-guard.sh`: shared guard runner used by hooks and manual calls

## Quick Use

Run guard manually:

```bash
bash plugins/thesaver-codex/scripts/run-guard.sh
```

Run full suite mode:

```bash
THESAVER_GUARD_FULL=1 bash plugins/thesaver-codex/scripts/run-guard.sh
```

Run pre-commit hook manually:

```bash
bash plugins/thesaver-codex/hooks/pre-commit.sh
```

## Wiring Suggestions

You can wire these scripts to your preferred runner (git hooks, task runner, or Codex automations).

Example git hook setup:

```bash
ln -sf ../../plugins/thesaver-codex/hooks/pre-commit.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```
