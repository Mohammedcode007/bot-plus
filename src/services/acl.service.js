import path from 'path';
import { JsonStore } from '../core/jsonStore.js';
import { ENV } from '../config/env.js';

const aclStore = new JsonStore(
  path.resolve('data/acl.json'),
  {
    ownerUsername: ENV.BOT_OWNER_USERNAME,
    admins: [],
    verifiedUsers: [],
  },
);

function cleanUsername(value) {
  return String(value || '').trim();
}

export async function getAcl() {
  const acl = await aclStore.read();

  if (!acl.ownerUsername && ENV.BOT_OWNER_USERNAME) {
    acl.ownerUsername = ENV.BOT_OWNER_USERNAME;
    await aclStore.write(acl);
  }

  return acl;
}

export async function isOwner(username) {
  const acl = await getAcl();
  return cleanUsername(username) === cleanUsername(acl.ownerUsername);
}

export async function isAdmin(username) {
  const acl = await getAcl();

  const name = cleanUsername(username);

  return acl.admins.includes(name);
}

export async function isOwnerOrAdmin(username) {
  return (await isOwner(username)) || (await isAdmin(username));
}

export async function isVerified(username) {
  const acl = await getAcl();
  return acl.verifiedUsers.includes(cleanUsername(username));
}

export async function addAdmin(username) {
  const name = cleanUsername(username);
  if (!name) return false;

  await aclStore.update((acl) => {
    if (!Array.isArray(acl.admins)) acl.admins = [];
    if (!acl.admins.includes(name)) acl.admins.push(name);
    return acl;
  });

  return true;
}

export async function removeAdmin(username) {
  const name = cleanUsername(username);
  if (!name) return false;

  await aclStore.update((acl) => {
    acl.admins = Array.isArray(acl.admins)
      ? acl.admins.filter((item) => item !== name)
      : [];

    return acl;
  });

  return true;
}

export async function verifyUser(username) {
  const name = cleanUsername(username);
  if (!name) return false;

  await aclStore.update((acl) => {
    if (!Array.isArray(acl.verifiedUsers)) acl.verifiedUsers = [];
    if (!acl.verifiedUsers.includes(name)) acl.verifiedUsers.push(name);
    return acl;
  });

  return true;
}

export async function unverifyUser(username) {
  const name = cleanUsername(username);
  if (!name) return false;

  await aclStore.update((acl) => {
    acl.verifiedUsers = Array.isArray(acl.verifiedUsers)
      ? acl.verifiedUsers.filter((item) => item !== name)
      : [];

    return acl;
  });

  return true;
}