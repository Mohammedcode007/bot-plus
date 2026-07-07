import express from 'express';
import path from 'path';

import { ENV } from './config/env.js';
import { WsClient } from './core/wsClient.js';
import { handlePrivateMessage } from './commands/privateCommands.js';
import { getAcl } from './services/acl.service.js';
import {
  restoreSavedBotSessions,
  updateMainBotProfile,
} from './services/botSession.service.js';

const app = express();

const HTTP_PORT = Number(
  process.env.HTTP_PORT ||
  process.env.PORT ||
  5000,
);

app.use(
  '/uploads',
  express.static(path.join(process.cwd(), 'public', 'uploads')),
);

app.get('/', (req, res) => {
  res.send('bot-plus is running');
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP server running on port ${HTTP_PORT}`);
  console.log(
    '📁 Uploads path:',
    path.join(process.cwd(), 'public', 'uploads'),
  );
});

function readText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();

    if (text) {
      return text;
    }
  }

  return '';
}

function readIncomingDm(data) {
  const message =
    data.message && typeof data.message === 'object'
      ? data.message
      : data;

  const fromUserId = readText(
    data.fromUserId,
    data.from_user_id,
    message.fromUserId,
    message.from_user_id,
    message.from,
  );

  const fromUsername = readText(
    data.fromUsername,
    data.from_username,
    message.fromUsername,
    message.from_username,
    message.username,
  );

  const text = readText(
    data.text,
    message.text,
    message.body,
    message.message,
  );

  return {
    fromUserId,
    fromUsername,
    text,
  };
}

async function main() {
  if (!ENV.ADMIN_BOT_PASSWORD) {
    console.log('❌ ADMIN_BOT_PASSWORD missing in .env');
    process.exit(1);
  }

  if (!ENV.BOT_OWNER_USERNAME) {
    console.log('⚠️ BOT_OWNER_USERNAME غير محدد في .env');
  }

  await getAcl();

  const mainBot = new WsClient({
    username: ENV.ADMIN_BOT_USERNAME,
    password: ENV.ADMIN_BOT_PASSWORD,
    label: `MAIN:${ENV.ADMIN_BOT_USERNAME}`,
  });

  mainBot.onMessage(async (data) => {
    const handler = String(data.handler || '');

    if (handler !== 'dm_message_event') {
      return;
    }

    const dm = readIncomingDm(data);

    if (!dm.fromUserId || !dm.text) {
      return;
    }

    await handlePrivateMessage({
      mainBot,
      fromUserId: dm.fromUserId,
      fromUsername: dm.fromUsername,
      text: dm.text,
    });
  });

  mainBot.connect();

  console.log('🚀 TalkinPlus bot started');

  /*
    استرجاع البوتات والغرف المحفوظة بعد تشغيل البوت الرئيسي.
    الانتظار 3 ثواني حتى يأخذ البوت الرئيسي فرصة للاتصال وتسجيل الدخول.
  */
  setTimeout(async () => {
    try {
      const result = await restoreSavedBotSessions(mainBot);

      updateMainBotProfile(mainBot);
    } catch (error) {
    }
  }, 3000);
}

main().catch((error) => {
  console.error('❌ BOT_FATAL_ERROR', error);
  process.exit(1);
});