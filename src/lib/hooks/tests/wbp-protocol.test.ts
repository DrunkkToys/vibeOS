import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { injectWBP } from '../chat-transform.js';
import { PROTOCOL_MARKER, PROTOCOL_TEXT } from '../../constants.js';

describe('injectWBP', () => {
  it('Adds WBP text after completed task', () => {
    const messages: any[] = [
      {
        info: { role: 'user' },
        parts: [
          {
            type: 'tool',
            tool: 'task',
            state: { status: 'completed', output: 'done' }
          }
        ]
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'Here is the result.' }]
      }
    ];
    injectWBP(messages);
    assert.ok(messages[1].parts[0].text.includes(PROTOCOL_MARKER));
  });

  it('No task tool -> no injection', () => {
    const messages: any[] = [
      {
        info: { role: 'user' },
        parts: [{ type: 'tool', tool: 'read', state: { status: 'completed' } }]
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'Okay.' }]
      }
    ];
    const original = messages[1].parts[0].text;
    injectWBP(messages);
    assert.equal(messages[1].parts[0].text, original);
  });

  it('Already has WBP -> no double injection', () => {
    const messages: any[] = [
      {
        info: { role: 'user' },
        parts: [
          {
            type: 'tool',
            tool: 'task',
            state: { status: 'completed', output: 'done' }
          }
        ]
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'Some text ' + PROTOCOL_MARKER + ' already here.' }]
      }
    ];
    const original = messages[1].parts[0].text;
    injectWBP(messages);
    assert.equal(messages[1].parts[0].text, original);
  });

  it('No text part in next msg', () => {
    const messages: any[] = [
      {
        info: { role: 'user' },
        parts: [
          {
            type: 'tool',
            tool: 'task',
            state: { status: 'completed', output: 'done' }
          }
        ]
      },
      {
        info: { role: 'assistant' },
        parts: []
      }
    ];
    injectWBP(messages);
    assert.equal(messages[1].parts.length, 1);
    assert.equal(messages[1].parts[0].type, 'text');
    assert.equal(messages[1].parts[0].text, PROTOCOL_TEXT);
    assert.equal(messages[1].parts[0].synthetic, true);
  });

  it('Non-array parts -> skip gracefully', () => {
    const messages: any[] = [
      {
        info: { role: 'user' },
        parts: undefined
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'Hello' }]
      }
    ];
    injectWBP(messages);
    assert.equal(messages[1].parts[0].text, 'Hello');
  });

  it('Incomplete task (status !== "completed")', () => {
    const messages: any[] = [
      {
        info: { role: 'user' },
        parts: [
          {
            type: 'tool',
            tool: 'task',
            state: { status: 'running' }
          }
        ]
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'Working on it...' }]
      }
    ];
    const original = messages[1].parts[0].text;
    injectWBP(messages);
    assert.equal(messages[1].parts[0].text, original);
  });

  it('Multiple tasks in sequence', () => {
    const messages: any[] = [
      {
        info: { role: 'user' },
        parts: [
          { type: 'tool', tool: 'task', state: { status: 'completed', output: 'first' } }
        ]
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'First result.' }]
      },
      {
        info: { role: 'user' },
        parts: [
          { type: 'tool', tool: 'task', state: { status: 'completed', output: 'second' } }
        ]
      },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'Second result.' }]
      }
    ];
    injectWBP(messages);
    assert.ok(messages[1].parts[0].text.includes(PROTOCOL_MARKER));
    assert.ok(messages[3].parts[0].text.includes(PROTOCOL_MARKER));
  });

  it('Edge: last message cannot be checked', () => {
    const messages: any[] = [
      {
        info: { role: 'user' },
        parts: [
          { type: 'tool', tool: 'task', state: { status: 'completed', output: 'done' } }
        ]
      }
    ];
    injectWBP(messages);
    assert.ok(true);
  });
});
