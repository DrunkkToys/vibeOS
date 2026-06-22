import { describe, it, expect } from 'vitest';
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
} from '../session-orchestrator';

describe('session-orchestrator', () => {
  it('normalizes session state and template metadata', () => {
    const session = normalizeSessionOrchestration({
      status: 'paused',
      locked: true,
      tags: 'ops, ops, dashboard',
      notes: [{ text: 'ship it' }, null],
      template: { id: 'quality', body: '  write tests  ', revision: 2 },
    }, 'sid-1');

    expect(session.session_id).toBe('sid-1');
    expect(session.status).toBe('paused');
    expect(session.locked).toBe(true);
    expect(session.tags).toEqual(['ops', 'dashboard']);
    expect(session.notes).toHaveLength(1);
    expect(session.template?.body).toBe('write tests');
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

    expect(annotated.version).toBe(started.version + 1);
    expect(retagged.tags).toEqual(['api', 'dashboard']);
    expect(paused.status).toBe('paused');
    expect(undone.status).toBe(retagged.status);
    expect(undone.tags).toEqual(retagged.tags);
  });

  it('compares and exports session state consistently', () => {
    const left = normalizeSessionOrchestration({ session_id: 'left', status: 'active', tags: ['api'] }, 'left');
    const right = normalizeSessionOrchestration({ session_id: 'right', status: 'archived', locked: true, tags: ['api', 'dashboard'] }, 'right');
    const compare = compareSessionOrchestrations(left, right);

    expect(compare.status_changed).toBe(true);
    expect(compare.lock_changed).toBe(true);
    expect(compare.tag_diff.added).toEqual(['dashboard']);

    const exported = exportSessionOrchestration(right, 'right');
    const imported = importSessionOrchestration(exported, 'right');
    expect(imported.session_id).toBe('right');
    expect(imported.status).toBe('archived');
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

    expect(listItem.recommendation).toContain('Resume');
    expect(detail.title).toBe('Active Session');
    expect(detail.recommendation).toContain('Resume');
    expect(resolveSessionTemplateOrDefault(detail.orchestration?.template).id).toBe('quality');
    expect(dashboard.home.title).toBe('Executive Summary');
    expect(dashboard.current_session.session_id).toBe('sid-current');
    expect(dashboard.current_session.recommendation).toContain('Resume');
    expect(dashboard.home.cards[0].value).toBe('sid-current');
  });
});
