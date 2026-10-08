import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const app = express();
const prisma = new PrismaClient();
const port = Number(process.env.PORT || 4000);
if (!process.env.DATABASE_URL || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('Set DATABASE_URL and a JWT_SECRET of at least 32 characters.'); process.exit(1);
}
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

const enums = { project: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'], task: ['PENDING', 'IN_PROGRESS', 'COMPLETED'], priority: ['LOW', 'MEDIUM', 'HIGH'] };
const date = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullable().optional()
  .refine((value) => value == null || (!Number.isNaN(Date.parse(value)) && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) === value)), 'Invalid date value.')
  .transform((value) => value === undefined ? undefined : value === null ? null : new Date(value));
const registerSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()), password: z.string().min(8).max(128) });
const loginSchema = z.object({ email: z.string().trim().email().transform((v) => v.toLowerCase()), password: z.string().min(1).max(128) });
const projectSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).optional().default(''), status: z.enum(enums.project).optional(), startDate: date, endDate: date });
const taskSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).optional().default(''), priority: z.enum(enums.priority).optional(), status: z.enum(enums.task).optional(), dueDate: date, projectId: z.string().min(1) });
const tokenFor = (user) => jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const publicUser = ({ id, name, email, createdAt }) => ({ id, name, email, createdAt });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many authentication attempts. Try again later.' } });
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const authenticate = asyncRoute(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    req.user = user; next();
  } catch { return res.status(401).json({ error: 'Session expired. Please sign in again.' }); }
});
const validate = (schema) => (req, res, next) => { const parsed = schema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request.' }); req.validated = parsed.data; next(); };
const paging = (req) => ({ skip: (Math.max(1, Number(req.query.page) || 1) - 1) * Math.min(100, Math.max(1, Number(req.query.limit) || 20)), take: Math.min(100, Math.max(1, Number(req.query.limit) || 20)), page: Math.max(1, Number(req.query.page) || 1) });
const paged = (items, total, page, limit) => ({ items, total, page, limit, pages: Math.ceil(total / limit) });

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/register', authLimiter, validate(registerSchema), asyncRoute(async (req, res) => {
  const { name, email, password } = req.validated;
  if (await prisma.user.findUnique({ where: { email } })) return res.status(409).json({ error: 'An account with this email already exists.' });
  const user = await prisma.user.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12) } });
  res.status(201).json({ user: publicUser(user), token: tokenFor(user) });
}));
app.post('/api/auth/login', authLimiter, validate(loginSchema), asyncRoute(async (req, res) => {
  const { email, password } = req.validated;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ user: publicUser(user), token: tokenFor(user) });
}));
app.post('/api/auth/logout', (_req, res) => res.json({ message: 'Signed out. Remove the token from this device.' }));
app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/projects', authenticate, asyncRoute(async (req, res) => {
  const { skip, take, page } = paging(req); const where = { ownerId: req.user.id };
  if (req.query.search) where.name = { contains: String(req.query.search).slice(0, 120), mode: 'insensitive' };
  if (enums.project.includes(req.query.status)) where.status = req.query.status;
  const [items, total] = await Promise.all([prisma.project.findMany({ where, skip, take, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { tasks: true } } } }), prisma.project.count({ where })]);
  res.json(paged(items, total, page, take));
}));
app.post('/api/projects', authenticate, validate(projectSchema), asyncRoute(async (req, res) => res.status(201).json({ project: await prisma.project.create({ data: { ...req.validated, ownerId: req.user.id } }) })));
app.get('/api/projects/:id', authenticate, asyncRoute(async (req, res) => {
  const project = await prisma.project.findFirst({ where: { id: req.params.id, ownerId: req.user.id }, include: { tasks: { orderBy: { createdAt: 'desc' } } } });
  if (!project) return res.status(404).json({ error: 'Project not found.' }); res.json({ project });
}));
app.put('/api/projects/:id', authenticate, validate(projectSchema.partial()), asyncRoute(async (req, res) => {
  const result = await prisma.project.updateMany({ where: { id: req.params.id, ownerId: req.user.id }, data: req.validated });
  if (!result.count) return res.status(404).json({ error: 'Project not found.' });
  res.json({ project: await prisma.project.findUnique({ where: { id: req.params.id } }) });
}));
app.delete('/api/projects/:id', authenticate, asyncRoute(async (req, res) => {
  const result = await prisma.project.deleteMany({ where: { id: req.params.id, ownerId: req.user.id } });
  if (!result.count) return res.status(404).json({ error: 'Project not found.' }); res.status(204).end();
}));

app.get('/api/tasks', authenticate, asyncRoute(async (req, res) => {
  const { skip, take, page } = paging(req); const where = { project: { ownerId: req.user.id } };
  if (req.query.search) where.name = { contains: String(req.query.search).slice(0, 120), mode: 'insensitive' };
  if (enums.task.includes(req.query.status)) where.status = req.query.status;
  if (enums.priority.includes(req.query.priority)) where.priority = req.query.priority;
  if (req.query.projectId) where.projectId = String(req.query.projectId);
  const [items, total] = await Promise.all([prisma.task.findMany({ where, skip, take, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], include: { project: { select: { id: true, name: true } } } }), prisma.task.count({ where })]);
  res.json(paged(items, total, page, take));
}));
app.post('/api/tasks', authenticate, validate(taskSchema), asyncRoute(async (req, res) => {
  const { projectId, ...data } = req.validated;
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: req.user.id } });
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  res.status(201).json({ task: await prisma.task.create({ data: { ...data, projectId }, include: { project: { select: { id: true, name: true } } } }) });
}));
app.get('/api/tasks/:id', authenticate, asyncRoute(async (req, res) => {
  const task = await prisma.task.findFirst({ where: { id: req.params.id, project: { ownerId: req.user.id } }, include: { project: { select: { id: true, name: true } } } });
  if (!task) return res.status(404).json({ error: 'Task not found.' }); res.json({ task });
}));
app.put('/api/tasks/:id', authenticate, validate(taskSchema.partial()), asyncRoute(async (req, res) => {
  const { projectId, ...data } = req.validated;
  if (projectId && !(await prisma.project.findFirst({ where: { id: projectId, ownerId: req.user.id } }))) return res.status(404).json({ error: 'Project not found.' });
  const result = await prisma.task.updateMany({ where: { id: req.params.id, project: { ownerId: req.user.id } }, data: { ...data, ...(projectId ? { projectId } : {}) } });
  if (!result.count) return res.status(404).json({ error: 'Task not found.' });
  res.json({ task: await prisma.task.findUnique({ where: { id: req.params.id }, include: { project: { select: { id: true, name: true } } } }) });
}));
app.delete('/api/tasks/:id', authenticate, asyncRoute(async (req, res) => {
  const result = await prisma.task.deleteMany({ where: { id: req.params.id, project: { ownerId: req.user.id } } });
  if (!result.count) return res.status(404).json({ error: 'Task not found.' }); res.status(204).end();
}));

app.get('/api/dashboard', authenticate, asyncRoute(async (req, res) => {
  const owner = { ownerId: req.user.id }; const project = { project: { ownerId: req.user.id } };
  const [totalProjects, projectsInProgress, totalTasks, completedTasks, pendingTasks, recentProjects, upcomingTasks] = await Promise.all([
    prisma.project.count({ where: owner }), prisma.project.count({ where: { ...owner, status: 'IN_PROGRESS' } }), prisma.task.count({ where: project }),
    prisma.task.count({ where: { ...project, status: 'COMPLETED' } }), prisma.task.count({ where: { ...project, status: 'PENDING' } }),
    prisma.project.findMany({ where: owner, orderBy: { updatedAt: 'desc' }, take: 4, include: { _count: { select: { tasks: true } } } }),
    prisma.task.findMany({ where: { ...project, status: { not: 'COMPLETED' } }, orderBy: { dueDate: 'asc' }, take: 5, include: { project: { select: { id: true, name: true } } } })
  ]);
  res.json({ stats: { totalProjects, projectsInProgress, totalTasks, completedTasks, pendingTasks }, recentProjects, upcomingTasks });
}));

const webDist = resolve(process.cwd(), 'apps/web/dist');
app.use(express.static(webDist));
app.get(/.*/, (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  res.sendFile(resolve(webDist, 'index.html'));
});
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` }));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'A record with this value already exists.' });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`Taskflow API listening on http://${host}:${port}`));
const shutdown = async () => { server.close(); await prisma.$disconnect(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
