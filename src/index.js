import { ENV } from './config/env.js';
import { WsClient } from './core/wsClient.js';
import { handlePrivateMessage } from './commands/privateCommands.js';
import { getAcl } from './services/acl.service.js';

function readText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
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
    label: 'MAIN:tebot',
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

    console.log('📩 [PRIVATE_COMMAND]', {
      fromUserId: dm.fromUserId,
      fromUsername: dm.fromUsername,
      text: dm.text,
    });

    await handlePrivateMessage({
      mainBot,
      fromUserId: dm.fromUserId,
      fromUsername: dm.fromUsername,
      text: dm.text,
    });
  });

  mainBot.connect();

  console.log('🚀 TalkinPlus bot started');
}

main().catch((error) => {
  console.error('❌ BOT_FATAL_ERROR', error);
  process.exit(1);
});