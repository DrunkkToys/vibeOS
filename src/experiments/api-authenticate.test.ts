import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { authenticate } from './api-authenticate.js';

const SECRET = 'test-secret';

function mockReqRes(header?: string) {
  const req: Record<string, unknown> = {
    headers: {} as Record<string, string>,
    user: undefined,
  };
  if (header) (req.headers as Record<string, string>).authorization = header;
  const res = {
    _status: 0,
    _body: null as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
  let called = false;
  const next = mock.fn(() => { called = true; });
  return { req, res, next, called: () => called };
}

describe('api-authenticate', () => {
  it('returns 401 for missing header', () => {
    const { req, res, next } = mockReqRes();
    authenticate(SECRET)(req as any, res as any, next);
    assert.equal(res._status, 401);
    assert.equal(next.mock.calls.length, 0);
  });

  it('returns 401 for non-Bearer header', () => {
    const { req, res, next } = mockReqRes('Basic dXNlcjpwYXNz');
    authenticate(SECRET)(req as any, res as any, next);
    assert.equal(res._status, 401);
    assert.equal(next.mock.calls.length, 0);
  });

  it('returns 401 for expired token', () => {
    const token = jwt.sign({ sub: 'user-1' }, SECRET, { expiresIn: '0s' });
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    authenticate(SECRET)(req as any, res as any, next);
    assert.equal(res._status, 401);
    assert.equal(next.mock.calls.length, 0);
  });

  it('returns 401 for token missing sub', () => {
    const token = jwt.sign({ role: 'admin' }, SECRET);
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    authenticate(SECRET)(req as any, res as any, next);
    assert.equal(res._status, 401);
    assert.equal(next.mock.calls.length, 0);
  });

  it('attaches req.user on valid token', () => {
    const token = jwt.sign({ sub: 'user-42' }, SECRET);
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    authenticate(SECRET)(req as any, res as any, next);
    assert.equal((req as any).user.id, 'user-42');
    assert.equal(next.mock.calls.length, 1);
  });

  it('rejects token signed with wrong secret', () => {
    const token = jwt.sign({ sub: 'user-1' }, 'wrong-secret');
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    authenticate(SECRET)(req as any, res as any, next);
    assert.equal(res._status, 401);
    assert.equal(next.mock.calls.length, 0);
  });
});
