import fs from 'fs/promises';
import path from 'path';

const ACL_FILE = path.resolve('data/acl.json');

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFC');
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function uniqueStringList(list) {
  const map = new Map();

  for (const item of Array.isArray(list) ? list : []) {
    const value = normalizeText(item);

    if (!value) {
      continue;
    }

    const key = normalizeKey(value);

    if (!map.has(key)) {
      map.set(key, value);
    }
  }

  return Array.from(map.values());
}

function normalizeUserRecord(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const username = normalizeText(user.username);

  if (!username) {
    return null;
  }

  return {
    username,
    verified: user.verified === true,
    vip: user.vip === true,
    points: Number.isFinite(Number(user.points))
      ? Number(user.points)
      : 0,
    updatedAt: normalizeText(user.updatedAt) || new Date().toISOString(),
  };
}

function uniqueUsersList(list) {
  const map = new Map();

  for (const item of Array.isArray(list) ? list : []) {
    const user = normalizeUserRecord(item);

    if (!user) {
      continue;
    }

    const key = normalizeKey(user.username);

    if (!map.has(key)) {
      map.set(key, user);
      continue;
    }

    /*
      دمج لو نفس المستخدم متكرر.
    */
    const old = map.get(key);

    map.set(key, {
      username: old.username || user.username,
      verified: old.verified === true || user.verified === true,
      vip: old.vip === true || user.vip === true,
      points: Number.isFinite(Number(old.points))
        ? Number(old.points)
        : Number(user.points) || 0,
      updatedAt: user.updatedAt || old.updatedAt || new Date().toISOString(),
    });
  }

  return Array.from(map.values());
}

async function ensureAclFile() {
  try {
    await fs.mkdir(path.dirname(ACL_FILE), {
      recursive: true,
    });

    await fs.access(ACL_FILE);
  } catch {
    const defaultData = {
      ownerUsername: normalizeText(process.env.BOT_OWNER_USERNAME),
      admins: [],
      users: [],
    };

    await fs.writeFile(
      ACL_FILE,
      JSON.stringify(defaultData, null, 2),
      'utf8',
    );
  }
}

function migrateOldAclShape(data) {
  const next = {
    ownerUsername: normalizeText(
      data.ownerUsername ||
        process.env.BOT_OWNER_USERNAME ||
        '',
    ),
    admins: uniqueStringList(data.admins),
    users: uniqueUsersList(data.users),
  };

  /*
    دعم الشكل القديم:
    verifiedUsers: []
    vipUsers: []
  */
  const oldVerifiedUsers = uniqueStringList(data.verifiedUsers);
  const oldVipUsers = uniqueStringList(data.vipUsers);

  for (const username of oldVerifiedUsers) {
    const user = getUserFromList(next.users, username);

    if (user) {
      user.verified = true;
      user.updatedAt = new Date().toISOString();
    } else {
      next.users.push({
        username,
        verified: true,
        vip: false,
        points: 0,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  for (const username of oldVipUsers) {
    const user = getUserFromList(next.users, username);

    if (user) {
      user.verified = true;
      user.vip = true;
      user.updatedAt = new Date().toISOString();
    } else {
      next.users.push({
        username,
        verified: true,
        vip: true,
        points: 0,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  next.users = uniqueUsersList(next.users);

  return next;
}

export async function getAcl() {
  await ensureAclFile();

  try {
    const raw = await fs.readFile(ACL_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');

    return migrateOldAclShape(
      data && typeof data === 'object'
        ? data
        : {},
    );
  } catch {
    return {
      ownerUsername: normalizeText(process.env.BOT_OWNER_USERNAME),
      admins: [],
      users: [],
    };
  }
}

async function saveAcl(data) {
  const next = migrateOldAclShape(data);

  await fs.mkdir(path.dirname(ACL_FILE), {
    recursive: true,
  });

  await fs.writeFile(
    ACL_FILE,
    JSON.stringify(next, null, 2),
    'utf8',
  );

  return next;
}

function listHasUsername(list, username) {
  const target = normalizeKey(username);

  if (!target) {
    return false;
  }

  return uniqueStringList(list).some((item) => {
    return normalizeKey(item) === target;
  });
}

function addToStringList(list, username) {
  const value = normalizeText(username);

  if (!value) {
    return uniqueStringList(list);
  }

  const next = uniqueStringList(list);

  if (!listHasUsername(next, value)) {
    next.push(value);
  }

  return uniqueStringList(next);
}

function removeFromStringList(list, username) {
  const target = normalizeKey(username);

  return uniqueStringList(list).filter((item) => {
    return normalizeKey(item) !== target;
  });
}

function getUserFromList(users, username) {
  const target = normalizeKey(username);

  if (!target) {
    return null;
  }

  return users.find((user) => {
    return normalizeKey(user.username) === target;
  }) || null;
}

function ensureUser(users, username) {
  const value = normalizeText(username);

  if (!value) {
    return null;
  }

  let user = getUserFromList(users, value);

  if (!user) {
    user = {
      username: value,
      verified: false,
      vip: false,
      points: 0,
      updatedAt: new Date().toISOString(),
    };

    users.push(user);
  }

  user.username = normalizeText(user.username || value);
  user.verified = user.verified === true;
  user.vip = user.vip === true;
  user.points = Number.isFinite(Number(user.points))
    ? Number(user.points)
    : 0;

  return user;
}

export async function isOwner(username) {
  const acl = await getAcl();
  const ownerUsername = normalizeKey(acl.ownerUsername);
  const target = normalizeKey(username);

  if (!ownerUsername || !target) {
    return false;
  }

  return ownerUsername === target;
}

export async function isAdmin(username) {
  const acl = await getAcl();

  return listHasUsername(acl.admins, username);
}

export async function isOwnerOrAdmin(username) {
  if (await isOwner(username)) {
    return true;
  }

  return await isAdmin(username);
}

export async function addAdmin(username) {
  const acl = await getAcl();

  acl.admins = addToStringList(acl.admins, username);

  return await saveAcl(acl);
}

export async function removeAdmin(username) {
  const acl = await getAcl();

  acl.admins = removeFromStringList(acl.admins, username);

  return await saveAcl(acl);
}

export async function verifyUser(username) {
  const acl = await getAcl();

  const user = ensureUser(acl.users, username);

  if (user) {
    user.verified = true;
    user.updatedAt = new Date().toISOString();
  }

  return await saveAcl(acl);
}

export async function unverifyUser(username) {
  const acl = await getAcl();

  const user = ensureUser(acl.users, username);

  if (user) {
    user.verified = false;

    /*
      لو المستخدم لم يعد موثقًا، لا يصح يبقى VIP.
    */
    user.vip = false;

    user.updatedAt = new Date().toISOString();
  }

  return await saveAcl(acl);
}

export async function isVerified(username) {
  const acl = await getAcl();

  const user = getUserFromList(acl.users, username);

  return user?.verified === true;
}

/*
  vip@username:
  يجعله VIP وموثق في نفس سجل المستخدم.
*/
export async function addVipUser(username) {
  const acl = await getAcl();

  const user = ensureUser(acl.users, username);

  if (user) {
    user.verified = true;
    user.vip = true;
    user.updatedAt = new Date().toISOString();
  }

  return await saveAcl(acl);
}

/*
  unvip@username:
  يلغي VIP فقط، ويترك verified كما هو.
*/
export async function removeVipUser(username) {
  const acl = await getAcl();

  const user = ensureUser(acl.users, username);

  if (user) {
    user.vip = false;
    user.updatedAt = new Date().toISOString();
  }

  return await saveAcl(acl);
}

export async function isVipUser(username) {
  const acl = await getAcl();

  const user = getUserFromList(acl.users, username);

  return user?.vip === true;
}

export async function getUserAccess(username) {
  const acl = await getAcl();

  const user = getUserFromList(acl.users, username);

  if (!user) {
    return {
      username: normalizeText(username),
      verified: false,
      vip: false,
      points: 0,
    };
  }

  return {
    username: user.username,
    verified: user.verified === true,
    vip: user.vip === true,
    points: Number(user.points) || 0,
  };
}

export async function setUserPoints(username, points) {
  const acl = await getAcl();

  const user = ensureUser(acl.users, username);

  if (user) {
    user.points = Number.isFinite(Number(points))
      ? Number(points)
      : 0;

    user.updatedAt = new Date().toISOString();
  }

  return await saveAcl(acl);
}

export async function addUserPoints(username, amount) {
  const acl = await getAcl();

  const user = ensureUser(acl.users, username);

  if (user) {
    const current = Number(user.points) || 0;
    const value = Number(amount) || 0;

    user.points = current + value;
    user.updatedAt = new Date().toISOString();
  }

  return await saveAcl(acl);
}