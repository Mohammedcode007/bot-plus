import fs from 'fs/promises';
import path from 'path';

import { clean, normalizeName } from '../utils/text.js';

const ACL_FILE = path.resolve('data/acl.json');

function defaultAclStore() { return { ownerUsername: '', admins: [], users: [] }; }

async function ensureAclFile() {
  try { await fs.mkdir(path.dirname(ACL_FILE), { recursive: true }); await fs.access(ACL_FILE); }
  catch { await fs.writeFile(ACL_FILE, JSON.stringify(defaultAclStore(), null, 2), 'utf8'); }
}

export async function readAclStoreForGames() {
  await ensureAclFile();
  try {
    const raw = await fs.readFile(ACL_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    data.users = Array.isArray(data.users) ? data.users : [];
    return data && typeof data === 'object' ? data : defaultAclStore();
  } catch { return defaultAclStore(); }
}

export async function writeAclStoreForGames(data) {
  data.users = Array.isArray(data.users) ? data.users : [];
  await fs.mkdir(path.dirname(ACL_FILE), { recursive: true });
  await fs.writeFile(ACL_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export async function getUserPoints(username) {
  const key = normalizeName(username);
  if (!key) return 0;
  const store = await readAclStoreForGames();
  const user = store.users.find((item) => normalizeName(item.username) === key);
  return Math.max(0, Number(user?.points) || 0);
}

export async function changeUserPoints(username, delta) {
  const finalUsername = clean(username);
  const key = normalizeName(finalUsername);
  const amount = Number(delta) || 0;
  if (!key) return { ok: false, points: 0, reason: 'missing_username' };

  const store = await readAclStoreForGames();
  let user = store.users.find((item) => normalizeName(item.username) === key);
  if (!user) {
    user = { username: finalUsername, verified: false, vip: false, points: 0, updatedAt: new Date().toISOString() };
    store.users.push(user);
  }
  const oldPoints = Math.max(0, Number(user.points) || 0);
  const nextPoints = Math.max(0, oldPoints + amount);
  user.points = nextPoints;
  user.updatedAt = new Date().toISOString();
  await writeAclStoreForGames(store);
  return { ok: true, username: user.username, oldPoints, delta: amount, points: nextPoints };
}

export async function transferUserPoints({ fromUsername, toUsername, amount }) {
  const finalFrom = clean(fromUsername);
  const finalTo = clean(toUsername);
  const finalAmount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!finalFrom || !finalTo) return { ok: false, reason: 'missing_user' };
  if (normalizeName(finalFrom) === normalizeName(finalTo)) return { ok: false, reason: 'same_user' };
  if (finalAmount <= 0) return { ok: false, reason: 'invalid_amount' };
  const fromPoints = await getUserPoints(finalFrom);
  if (fromPoints < finalAmount) return { ok: false, reason: 'not_enough_points', fromPoints };
  await changeUserPoints(finalFrom, -finalAmount);
  const toResult = await changeUserPoints(finalTo, finalAmount);
  const fromFinal = await getUserPoints(finalFrom);
  return { ok: true, amount: finalAmount, fromUsername: finalFrom, toUsername: finalTo, fromPoints: fromFinal, toPoints: toResult.points };
}

export async function getTopPointsUsers(limit = 10) {
  const store = await readAclStoreForGames();
  return store.users
    .map((user) => ({ username: clean(user.username), points: Math.max(0, Number(user.points) || 0) }))
    .filter((user) => user.username)
    .sort((a, b) => b.points - a.points)
    .slice(0, Math.max(1, Number(limit) || 10));
}
