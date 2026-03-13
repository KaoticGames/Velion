import jwt from 'jsonwebtoken';

export interface AccessTokenPayload {
  user_id:           string;
  email:             string;
  subscription_tier: string;
}

export interface RefreshTokenPayload {
  user_id:  string;
  token_id: string;
}

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });

export const signRefreshToken = (payload: RefreshTokenPayload): string =>
  jwt.sign(payload, REFRESH_SECRET, { expiresIn: '30d' });

export const verifyAccessToken = (token: string): AccessTokenPayload =>
  jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;

export const verifyRefreshToken = (token: string): RefreshTokenPayload =>
  jwt.verify(token, REFRESH_SECRET) as RefreshTokenPayload;
