// [vibeOS-enforced] Skeleton test — replace with real assertions
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../tool-execute.js';

describe('tool-execute', () => {
  it('smoke: module loads', () => {
    assert.notEqual(mod, undefined);
  });

  const exportedFns = [
    'setToolDirectory',
    'onToolExecuteBefore',
    'onToolExecuteAfter',
  ] as const;

  for (const fnName of exportedFns) {
    it(`${fnName} is exported`, () => {
      assert.equal(typeof (mod as Record<string, unknown>)[fnName], 'function');
    });

    it.todo(`should ${fnName} with valid input`);
    it.todo(`should handle invalid input for ${fnName}`);
    it.todo(`should handle edge cases in ${fnName}`);
  }

  // Regression (live-reproduced twice, 2026-08-09, driving an M5 diagnostic
  // session): the loop-guard used to neutralize a blocked bash command by
  // rewriting it to embed the guard's own warning text as an echoed command.
  // That put the warning into the model's own tool-call history, so on the
  // next turn the model would see its "last command" already looking like a
  // guard message and re-emit something matching it -- re-triggering the
  // guard every time and producing an unbreakable self-referential loop
  // (15+ consecutive blocked turns observed live). The neutralized command
  // must never contain the directive text.
  describe('_neutralizeBashLoopForTest: does not leak directive text into the command', () => {
    it('replaces command with an inert no-op, not an echo of the directive', () => {
      const directive = 'You have polled the same status 10 times — STOP polling in-band.'
      const input = { args: { command: `ssh m5 'ps -p 8162'` } }
      const output = { args: { command: `ssh m5 'ps -p 8162'` } }
      ;(mod as any)._neutralizeBashLoopForTest(input, output, directive)

      for (const src of [input.args, output.args]) {
        assert.ok(!src.command.includes('[vibeOS loop-guard]'), 'command must not contain the bracketed guard tag')
        assert.ok(!src.command.startsWith('echo'), 'command must not be an echo (nothing should print the guard text as tool output)')
        assert.ok(!src.command.includes(directive), 'command must not contain the directive text')
      }
      assert.equal((output as any).blocked, true)
      assert.equal((output as any).status, 'error')
    })

    it('neutralizes cmd and script fields the same way as command', () => {
      const directive = 'STOP repeating it.'
      const input = { args: { cmd: 'gh pr view 348', script: 'gh pr view 348' } }
      const output = { args: {} }
      ;(mod as any)._neutralizeBashLoopForTest(input, output, directive)

      assert.ok(!input.args.cmd.includes(directive))
      assert.ok(!input.args.script.includes(directive))
    })

    it('still marks the tool result blocked so the model gets a real stop signal', () => {
      const input = { args: { command: 'sleep 60 && gh pr view 1' } }
      const output = { args: { command: 'sleep 60 && gh pr view 1' } }
      ;(mod as any)._neutralizeBashLoopForTest(input, output, 'stop')
      assert.equal((output as any).blocked, true)
      assert.equal((output as any).status, 'error')
      assert.ok(typeof (output as any).error === 'string' && (output as any).error.length > 0)
    })
  })
});
