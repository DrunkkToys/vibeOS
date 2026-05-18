# VibeTheOG Guard Skill

Use this skill when the user asks to run VibeTheOG Codex guardrails.

## Workflow

1. Run the guard:

```bash
bash plugins/vibetheog-codex/scripts/run-guard.sh
```

2. If guard fails, show the first actionable failure and suggest the smallest fix.
3. Re-run guard after fixes.
4. Report what changed and whether guard is now clean.
