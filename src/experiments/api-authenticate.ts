import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface AuthRequest extends Request {
  user?: { id: string };
}

export function authenticate(secret: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }
    const token = header.slice(7);
    try {
      const payload = jwt.verify(token, secret) as { sub: string };
      if (!payload.sub) {
        res.status(401).json({ error: 'Token missing subject claim' });
        return;
      }
      req.user = { id: payload.sub };
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}
