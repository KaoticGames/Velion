import path from 'path';
import { config } from 'dotenv';
import express                  from 'express';
import cors                     from 'cors';
import helmet                   from 'helmet';
import cookieParser             from 'cookie-parser';
import rateLimit                from 'express-rate-limit';
import { createServer }         from 'http';
import { Server as SocketServer } from 'socket.io';

// Routes
import authRouter               from './routes/auth';
import characterRouter          from './routes/characters';
import { campaignsRouter }      from './routes/campaigns';
import libraryRouter            from './routes/library';
import homebrewRouter           from './routes/homebrew';
import billingRouter            from './routes/billing';
import uploadsRouter            from './routes/uploads';
import inventoryRouter          from './routes/inventory';
import sessionsRouter          from './routes/sessions';
import vttRouter              from './routes/vtt';
import earlyAccessRouter      from './routes/earlyAccess';

// Socket
import { registerSessionNamespace } from './socket/session';

// Load env after all imports — dotenv config calls must not sit between import statements
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
config({ path: path.resolve(process.cwd(), envFile) });
config({ path: path.resolve(process.cwd(), '.env') });

// BigInt can't be JSON-serialized by default — return as string so the frontend
// can handle large HP values without precision loss (JS number max is 2^53-1)
(BigInt.prototype as unknown as Record<string, unknown>).toJSON = function () {
  return this.toString();
};

const app    = express();
const server = createServer(app);
const PORT   = parseInt(process.env.PORT ?? '3001', 10);
const isDev  = process.env.NODE_ENV !== 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

// ── Socket.io ─────────────────────────────────────────────────────────────
const io = new SocketServer(server, {
  cors: {
    origin:      CORS_ORIGIN,
    credentials: true,
  },
  // Prefer WebSocket, fall back to polling for corporate firewalls
  transports: ['websocket', 'polling'],
});

registerSessionNamespace(io);

// ── Core middleware ───────────────────────────────────────────────────────
app.use(helmet({
  // Required for Socket.io and API responses
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin:      CORS_ORIGIN,
  credentials: true,         // Required: sends HttpOnly refresh cookie
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(cookieParser());

// ── Stripe webhook must receive raw Buffer (before JSON parser) ───────────
app.use(
  '/api/v1/billing/webhook',
  express.raw({ type: 'application/json' }),
);

// ── JSON body parser ──────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max:      isDev ? 1000 : 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests.', status: 429 } },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      isDev ? 100 : 20,   // stricter for auth endpoints
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many auth attempts.', status: 429 } },
});

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',         authLimiter, authRouter);
app.use('/api/v1/early-access', apiLimiter,  earlyAccessRouter);
app.use('/api/v1/characters', apiLimiter,  characterRouter);
app.use('/api/v1/campaigns',  apiLimiter,  campaignsRouter);
app.use('/api/v1/sessions',   apiLimiter,  sessionsRouter);
app.use('/api/v1/vtt',        apiLimiter,  vttRouter);
app.use('/api/v1/library',    apiLimiter,  libraryRouter);
app.use('/api/v1/library',    apiLimiter,  homebrewRouter);
app.use('/api/v1/inventory',  apiLimiter,  inventoryRouter);
app.use('/api/v1/billing',    apiLimiter,  billingRouter);
app.use('/api/v1/tokens',     apiLimiter,  uploadsRouter);

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    env:     process.env.NODE_ENV,
    version: '0.1.0',
    ts:      new Date().toISOString(),
  });
});

// ── 404 for unmatched API routes ──────────────────────────────────────────
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.', status: 404 } });
});

// ── Global error handler ──────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message, isDev ? err.stack : '');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: isDev ? err.message : 'Internal server error.', status: 500 } });
});

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   VELION MYTHERA API                     ║
  ║   http://localhost:${PORT}                   ║
  ║   ENV: ${(process.env.NODE_ENV ?? 'development').padEnd(34)}║
  ╚══════════════════════════════════════════╝
  `);
});

export { app, server, io };