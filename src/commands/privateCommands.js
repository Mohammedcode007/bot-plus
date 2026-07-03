import {
  addAdmin,
  removeAdmin,
  verifyUser,
  unverifyUser,
  isOwner,
  isOwnerOrAdmin,
  isVerified,
} from '../services/acl.service.js';

import {
  addControlledBot,
  addSilentBot,
  addMusicBot,
} from '../services/botRegistry.service.js';

import { startBotSession } from '../services/botSession.service.js';
import { parsePrivateCommand } from './parser.js';

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFC');
}

function getOwnerUserId() {
  return normalizeText(process.env.BOT_OWNER_USER_ID);
}

function getOwnerUsername() {
  return normalizeText(process.env.BOT_OWNER_USERNAME);
}

/*
  فحص المالك:
  الأفضل بالـ userId لأنه ثابت ولا يتأثر بزخرفة الاسم.
*/
async function isMessageFromOwner({ fromUserId, fromUsername }) {
  const senderUserId = normalizeText(fromUserId);
  const senderUsername = normalizeText(fromUsername);

  const ownerUserId = getOwnerUserId();
  const ownerUsername = getOwnerUsername();

  if (ownerUserId && senderUserId === ownerUserId) {
    return true;
  }

  if (ownerUsername && senderUsername === ownerUsername) {
    return true;
  }

  /*
    احتياطي لو acl.service فيه مالك محفوظ بالاسم.
  */
  if (senderUsername && await isOwner(senderUsername)) {
    return true;
  }

  return false;
}

/*
  فحص مالك أو أدمن:
  المالك بالـ userId أولًا، ثم الأدمن بالاسم.
*/
async function isMessageFromOwnerOrAdmin({ fromUserId, fromUsername }) {
  if (await isMessageFromOwner({ fromUserId, fromUsername })) {
    return true;
  }

  const senderUsername = normalizeText(fromUsername);

  if (senderUsername && await isOwnerOrAdmin(senderUsername)) {
    return true;
  }

  return false;
}

/*
  فحص موثق:
  حاليًا حسب نظامك القديم يعتمد على username.
*/
async function isMessageFromVerified({ fromUsername }) {
  const senderUsername = normalizeText(fromUsername);

  if (!senderUsername) {
    return false;
  }

  return await isVerified(senderUsername);
}

function getSenderLabel({ fromUserId, fromUsername }) {
  const username = normalizeText(fromUsername);
  const userId = normalizeText(fromUserId);

  return username || userId || 'unknown';
}

export function helpText() {
  return [
    '📌 أوامر البوت:',
    '',
    'help',
    'عرض هذه القائمة.',
    '',
    '👑 للمالك فقط:',
    'admin@username',
    'unadmin@username',
    '',
    '👑 للمالك والأدمن:',
    'V@username',
    'unv@username',
    '',
    '🤖 بوت متحكم واحد لكل غرفة:',
    'username@password@room',
    '',
    '🔇 بوت صامت متعدد:',
    'bot@username@password@room',
    '',
    '🎵 بوت مزيكا واحد لكل غرفة:',
    'join@room',
  ].join('\n');
}

export async function handlePrivateMessage({
  mainBot,
  fromUserId,
  fromUsername,
  text,
}) {
  const parsed = parsePrivateCommand(text);

  const senderInfo = {
    fromUserId,
    fromUsername,
  };

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📩 [PRIVATE_COMMAND_HANDLER]', {
    fromUserId,
    fromUsername,
    ownerUserId: getOwnerUserId(),
    ownerUsername: getOwnerUsername(),
    text,
    parsed,
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (parsed.command === 'help') {
    mainBot.sendDm(fromUserId, helpText());
    return;
  }

  if (parsed.command === 'add_admin') {
    if (!(await isMessageFromOwner(senderInfo))) {
      mainBot.sendDm(fromUserId, '❌ هذا الأمر للمالك فقط.');
      return;
    }

    const username = normalizeText(parsed.args[0]);

    if (!username) {
      mainBot.sendDm(fromUserId, '❌ اكتب اسم المستخدم.\nمثال: admin@username');
      return;
    }

    await addAdmin(username);

    mainBot.sendDm(
      fromUserId,
      `✅ تم إضافة ${username} إلى قائمة الأدمن.`,
    );

    return;
  }

  if (parsed.command === 'remove_admin') {
    if (!(await isMessageFromOwner(senderInfo))) {
      mainBot.sendDm(fromUserId, '❌ هذا الأمر للمالك فقط.');
      return;
    }

    const username = normalizeText(parsed.args[0]);

    if (!username) {
      mainBot.sendDm(fromUserId, '❌ اكتب اسم المستخدم.\nمثال: unadmin@username');
      return;
    }

    await removeAdmin(username);

    mainBot.sendDm(
      fromUserId,
      `✅ تم حذف ${username} من قائمة الأدمن.`,
    );

    return;
  }

  if (parsed.command === 'verify') {
    if (!(await isMessageFromOwnerOrAdmin(senderInfo))) {
      mainBot.sendDm(fromUserId, '❌ هذا الأمر للمالك أو الأدمن فقط.');
      return;
    }

    const username = normalizeText(parsed.args[0]);

    if (!username) {
      mainBot.sendDm(fromUserId, '❌ اكتب اسم المستخدم.\nمثال: V@username');
      return;
    }

    await verifyUser(username);

    mainBot.sendDm(fromUserId, `✅ تم توثيق ${username}.`);
    return;
  }

  if (parsed.command === 'unverify') {
    if (!(await isMessageFromOwnerOrAdmin(senderInfo))) {
      mainBot.sendDm(fromUserId, '❌ هذا الأمر للمالك أو الأدمن فقط.');
      return;
    }

    const username = normalizeText(parsed.args[0]);

    if (!username) {
      mainBot.sendDm(fromUserId, '❌ اكتب اسم المستخدم.\nمثال: unv@username');
      return;
    }

    await unverifyUser(username);

    mainBot.sendDm(fromUserId, `✅ تم إلغاء توثيق ${username}.`);
    return;
  }

  if (parsed.command === 'add_controlled_bot') {
    const allowed =
      (await isMessageFromOwnerOrAdmin(senderInfo)) ||
      (await isMessageFromVerified(senderInfo));

    if (!allowed) {
      mainBot.sendDm(fromUserId, '❌ هذا الأمر يحتاج توثيق أو أدمن.');
      return;
    }

    const username = normalizeText(parsed.args[0]);
    const password = normalizeText(parsed.args[1]);
    const room = normalizeText(parsed.args[2]);

    if (!username || !password || !room) {
      mainBot.sendDm(
        fromUserId,
        '❌ صيغة الأمر غير صحيحة.\nمثال:\nusername@password@room',
      );
      return;
    }

    const result = await addControlledBot({
      username,
      password,
      room,
      createdBy: getSenderLabel(senderInfo),
    });

    mainBot.sendDm(fromUserId, result.message);

    if (result.ok) {
      const started = startBotSession({
        username,
        password,
        room,
        type: 'controlled',
      });

      mainBot.sendDm(fromUserId, started.message);
    }

    return;
  }

  if (parsed.command === 'add_silent_bot') {
    const allowed =
      (await isMessageFromOwnerOrAdmin(senderInfo)) ||
      (await isMessageFromVerified(senderInfo));

    if (!allowed) {
      mainBot.sendDm(fromUserId, '❌ هذا الأمر يحتاج توثيق أو أدمن.');
      return;
    }

    const username = normalizeText(parsed.args[0]);
    const password = normalizeText(parsed.args[1]);
    const room = normalizeText(parsed.args[2]);

    if (!username || !password || !room) {
      mainBot.sendDm(
        fromUserId,
        '❌ صيغة الأمر غير صحيحة.\nمثال:\nbot@username@password@room',
      );
      return;
    }

    const result = await addSilentBot({
      username,
      password,
      room,
      createdBy: getSenderLabel(senderInfo),
    });

    mainBot.sendDm(fromUserId, result.message);

    if (result.ok) {
      const started = startBotSession({
        username,
        password,
        room,
        type: 'silent',
      });

      mainBot.sendDm(fromUserId, started.message);
    }

    return;
  }

  if (parsed.command === 'add_music_bot') {
    const allowed =
      (await isMessageFromOwnerOrAdmin(senderInfo)) ||
      (await isMessageFromVerified(senderInfo));

    if (!allowed) {
      mainBot.sendDm(fromUserId, '❌ هذا الأمر يحتاج توثيق أو أدمن.');
      return;
    }

    const room = normalizeText(parsed.args[0]);

    if (!room) {
      mainBot.sendDm(
        fromUserId,
        '❌ اكتب اسم الغرفة.\nمثال:\njoin@room',
      );
      return;
    }

    const musicUsername = normalizeText(process.env.MUSIC_BOT_USERNAME);
    const musicPassword = normalizeText(process.env.MUSIC_BOT_PASSWORD);

    if (!musicUsername || !musicPassword) {
      mainBot.sendDm(
        fromUserId,
        '❌ بيانات بوت المزيكا غير موجودة في ملف .env.',
      );
      return;
    }

    const result = await addMusicBot({
      room,
      createdBy: getSenderLabel(senderInfo),
    });

    mainBot.sendDm(fromUserId, result.message);

    if (result.ok) {
      const started = startBotSession({
        username: musicUsername,
        password: musicPassword,
        room,
        type: 'music',
      });

      mainBot.sendDm(fromUserId, started.message);
    }

    return;
  }

  if (parsed.command === 'unknown') {
    mainBot.sendDm(
      fromUserId,
      '❌ أمر غير معروف.\nاكتب help لعرض الأوامر.',
    );
  }
}