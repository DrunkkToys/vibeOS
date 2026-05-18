# VibeTheOG Codex Plugin

This plugin adds a Codex-native companion layer for `VibeTheOG` with:

- Plugin manifest (`.codex-plugin/plugin.json`)
- Hook scripts (`hooks/`)
- Reusable script entrypoint (`scripts/run-guard.sh`)
- Skill prompt for consistent behavior (`skills/vibetheog-guard/SKILL.md`)

## Layout

- `hooks/pre-commit.sh`: runs lightweight validation before commit
- `hooks/post-command-summary.sh`: records a short operation summary
- `scripts/run-guard.sh`: shared guard runner used by hooks and manual calls

## Quick Use

Run guard manually:

```bash
bash plugins/vibetheog-codex/scripts/run-guard.sh
```

Run full suite mode:

```bash
VIBETHEOG_GUARD_FULL=1 bash plugins/vibetheog-codex/scripts/run-guard.sh
```

Run pre-commit hook manually:

```bash
bash plugins/vibetheog-codex/hooks/pre-commit.sh
```

## Wiring Suggestions

You can wire these scripts to your preferred runner (git hooks, task runner, or Codex automations).

Example git hook setup:

```bash
ln -sf ../../plugins/vibetheog-codex/hooks/pre-commit.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```
