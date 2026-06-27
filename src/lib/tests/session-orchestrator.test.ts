import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSessionOrchestration,
  applySessionAction,
  compareSessionOrchestrations,
  exportSessionOrchestration,
  importSessionOrchestration,
  buildSessionListItem,
  buildSessionDetail,
  buildDashboardHomeModel,
  resolveSessionTemplateOrDefault,
} from '../session-orchestrator.js';

describe('session-orchestrator', () => {
  it('normalizes session state and template metadata', () => {
    const session = normalizeSessionOrchestration({
      status: 'paused',
      locked: true,
      tags: 'ops, ops, dashboard',
      notes: [{ text: 'ship it' }, null],
      template: { id: 'quality', body: '  write tests  ', revision: 2 },
    }, 'sid-1');

    assert.equal(session.session_id, 'sid-1');
    assert.equal(session.status, 'paused');
    assert.equal(session.locked, true);
    assert.deepEqual(session.tags, ['ops', 'dashboard']);
    assert.equal(session.notes.length, 1);
    assert.equal(session.template?.body, 'write tests');
  });

  it('applies actions, versions history, and supports undo', () => {
    const started = normalizeSessionOrchestration({
      status: 'active',
      template: { id: 'save', body: 'Keep it short.' },
    }, 'sid-2');
    const annotated = applySessionAction(started, 'annotate', { note: 'first note' });
    const retagged = applySessionAction(annotated, 'retag', { tags: ['api', 'dashboard'] });
    const paused = applySessionAction(retagged, 'pause');
    const undone = applySessionAction(paused, 'undo');

    assert.equal(annotated.version, started.version + 1);
    assert.deepEqual(retagged.tags, ['api', 'dashboard']);
    assert.equal(paused.status, 'paused');
    assert.equal(undone.status, retagged.status);
    assert.deepEqual(undone.tags, retagged.tags);
  });

  it('compares and exports session state consistently', () => {
    const left = normalizeSessionOrchestration({ session_id: 'left', status: 'active', tags: ['api'] }, 'left');
    const right = normalizeSessionOrchestration({ session_id: 'right', status: 'archived', locked: true, tags: ['api', 'dashboard'] }, 'right');
    const compare = compareSessionOrchestrations(left, right);

    assert.equal(compare.status_changed, true);
    assert.equal(compare.lock_changed, true);
    assert.deepEqual(compare.tag_diff.added, ['dashboard']);

    const exported = exportSessionOrchestration(right, 'right');
    const imported = importSessionOrchestration(exported, 'right');
    assert.equal(imported.session_id, 'right');
    assert.equal(imported.status, 'archived');
  });

  it('builds list, detail, and dashboard models with real content', () => {
    const session = {
      started: '2026-06-19T10:00:00.000Z',
      cost_usd: 3.25,
      orchestration: normalizeSessionOrchestration({
        status: 'paused',
        locked: false,
        tags: ['api', 'dashboard'],
        notes: [{ text: 'Need a per-session TDD template.' }],
        template: { id: 'quality', body: 'Use three focused tests.', revision: 1 },
      }, 'sid-current'),
    };

    const listItem = buildSessionListItem('sid-current', session, {}, true);
    const detail = buildSessionDetail('sid-current', session, {}, { enabled: true, sub_regime: 'REFINING', resolution: 'working', momentum: 0.6 }, { current_session_id: 'sid-current' });
    const dashboard = buildDashboardHomeModel({
      currentSessionId: 'sid-current',
      status: { active_slot: 'brain', optimization_mode: 'quality' },
      savings: { lifetime: { delegation_usd: 11, cache_usd: 2 }, current_session: { delegation_usd: 4, cache_usd: 1 } },
      todos: [{ status: 'pending' }, { status: 'done' }],
      blackbox: { enabled: true, sub_regime: 'REFINING', resolution: 'working', momentum: 0.6 },
      sessions: { 'sid-current': session, 'sid-old': { started: '2026-06-18T10:00:00.000Z', orchestration: normalizeSessionOrchestration({ status: 'active' }, 'sid-old') } },
      metrics: { sesTasks: 7, sesDuration: 55 },
      currentProjectName: 'demo-project',
    });

    assert.ok(listItem.recommendation.includes('Resume'));
    assert.equal(detail.title, 'Active Session');
    assert.ok(detail.recommendation.includes('Resume'));
    assert.equal(resolveSessionTemplateOrDefault(detail.orchestration?.template).id, 'quality');
    assert.equal(dashboard.home.title, 'Executive Summary');
    assert.equal(dashboard.current_session.session_id, 'sid-current');
    assert.ok(dashboard.current_session.recommendation.includes('Resume'));
    assert.equal(dashboard.home.cards[0].value, 'sid-current');
  });
});
