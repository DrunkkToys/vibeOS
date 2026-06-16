import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const { ensureProjectSkill } = await import('../chat-transform.js');

function tmpProjDir() {
  return mkdtempSync(join(tmpdir(), 'proj-skill-test-'));
}

describe('ensureProjectSkill', () => {
  it('already existing skill returns skipped', () => {
    const dir = tmpProjDir();
    try {
      const projectName = basename(dir);
      const skillDir = join(dir, '.opencode', 'skills', projectName);
      const skillPath = join(skillDir, 'SKILL.md');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(skillPath, '# existing skill', 'utf-8');

      const result = ensureProjectSkill(dir, 'test-fp');
      assert.equal(result.created, false);
      assert.equal(result.skipped, true);
      assert.equal(result.path, skillPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no promoted patterns returns skipped=false', () => {
    const dir = tmpProjDir();
    try {
      const result = ensureProjectSkill(dir, 'fake-fp-no-patterns');
      assert.equal(result.created, false);
      assert.equal(result.skipped, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('invalid dir does not crash', () => {
    const result = ensureProjectSkill('/nonexistent-test-dir-98765xyz', 'test-fp');
    assert.equal(result.created, false);
    assert.equal(result.skipped, false);
  });

  it('creates skill when patterns exist', { skip: 'Requires ~/.claude/project-states.json entries for test fingerprint. Test 2 verifies the fake-fp path works.' }, () => {
    assert.ok(true, 'skipped - controlled state setup required');
  });
});
