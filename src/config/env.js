import dotenv from 'dotenv';

dotenv.config();

export const ENV = {
  WS_URL: process.env.WS_URL || 'wss://te-bot.site/ws',

  ADMIN_BOT_USERNAME:
    process.env.ADMIN_BOT_USERNAME || 'tebot',

  ADMIN_BOT_PASSWORD:
    process.env.ADMIN_BOT_PASSWORD || '',

  MUSIC_BOT_USERNAME:
    process.env.MUSIC_BOT_USERNAME || 'music_dj',

  MUSIC_BOT_PASSWORD:
    process.env.MUSIC_BOT_PASSWORD || '',

  BOT_SESSION:
    String(process.env.BOT_SESSION || '').trim(),

  BOT_SDK:
    String(process.env.BOT_SDK || '25').trim(),

  BOT_VERSION:
    String(process.env.BOT_VERSION || '332').trim(),

  BOT_ID:
    String(process.env.BOT_ID || 'tebot').trim(),

  BOT_OWNER_USER_ID:
    String(process.env.BOT_OWNER_USER_ID || '').trim(),

  BOT_OWNER_USERNAME:
    String(process.env.BOT_OWNER_USERNAME || '').trim(),

  RECONNECT_DELAY_MS:
    Number(process.env.RECONNECT_DELAY_MS || 5000),

  PING_INTERVAL_MS:
    Number(process.env.PING_INTERVAL_MS || 25000),
};