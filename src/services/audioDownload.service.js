import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const AUDIO_TEMP_DIR = path.join(
  process.cwd(),
  'public',
  'uploads',
  'audio-temp',
);

export const AUDIO_DELETE_EXTRA_MS = 2 * 60 * 1000;
export const AUDIO_FALLBACK_TTL_MS = 10 * 60 * 1000;

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, {
      recursive: true,
    });
  }
}

function buildBaseUrl() {
  const raw =
    process.env.APP_BASE_URL ||
    process.env.BASE_URL ||
    `http://localhost:${process.env.PORT || 5000}`;

  console.log('🌐 buildBaseUrl raw:', raw);

  return String(raw).replace(/\/+$/, '');
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function getYtDlpBin() {
  return process.env.YT_DLP_BIN || '/usr/local/bin/yt-dlp';
}

function makeYtDlpEnv() {
  return {
    ...process.env,
    PATH: [
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/root/.local/bin',
      '/root/.deno/bin',
      process.env.PATH || '',
    ].join(':'),
  };
}

function getCookiesPath() {
  return (
    process.env.YT_DLP_COOKIES_PATH ||
    process.env.YTDLP_COOKIES_PATH ||
    path.join(process.cwd(), 'cookies.txt')
  );
}

async function getAudioDurationMs(filePath) {
  try {
    const { stdout, stderr } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      {
        windowsHide: true,
      },
    );

    if (stderr) {
      console.log('⚠️ ffprobe stderr:', stderr);
    }

    const seconds = Number(String(stdout || '').trim());

    if (!Number.isFinite(seconds) || seconds <= 0) {
      console.log('⚠️ Could not detect audio duration, fallback will be used');
      return 0;
    }

    const durationMs = Math.ceil(seconds * 1000);

    console.log('⏱️ Audio duration seconds:', seconds);
    console.log('⏱️ Audio duration ms:', durationMs);

    return durationMs;
  } catch (error) {
    console.error(
      '❌ ffprobe duration error:',
      error?.message || error,
    );

    return 0;
  }
}

export async function downloadAudioToLocal(params = {}) {
  const sourceUrl = params.sourceUrl;

  if (!sourceUrl) {
    throw new Error('sourceUrl is required');
  }

  ensureDirExists(AUDIO_TEMP_DIR);

  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputTemplate = path.join(AUDIO_TEMP_DIR, `${fileId}.%(ext)s`);

  const cookiesPath = getCookiesPath();

  if (!fileExists(cookiesPath)) {
    throw new Error(`cookies.txt not found at: ${cookiesPath}`);
  }

  const env = makeYtDlpEnv();

  /*
    تحميل باستخدام cookies.
    هذا أفضل حل عند ظهور:
    Sign in to confirm you’re not a bot
    أو:
    HTTP Error 429
  */
  const args = [
    '--no-update',

    '--cookies',
    cookiesPath,

    '--js-runtimes',
    'deno',

    '--force-ipv4',

    '--extractor-args',
    'youtube:player_client=android,web,ios',

    '-f',
    'bestaudio[ext=m4a]/bestaudio/best',

    '--extract-audio',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0',

    '--no-playlist',
    '--restrict-filenames',

    '--socket-timeout',
    '30',
    '--retries',
    '5',
    '--fragment-retries',
    '5',

    '--sleep-requests',
    '1',
    '--sleep-interval',
    '1',
    '--max-sleep-interval',
    '3',

    '-o',
    outputTemplate,

    sourceUrl,
  ];

  console.log('🎧 yt-dlp sourceUrl:', sourceUrl);
  console.log('🎧 yt-dlp outputTemplate:', outputTemplate);
  console.log('🍪 yt-dlp cookiesPath:', cookiesPath);
  console.log('🧠 yt-dlp bin:', getYtDlpBin());
  console.log('🧠 yt-dlp PATH:', env.PATH);
  console.log('🎛️ yt-dlp args:', args);

  try {
    const { stdout, stderr } = await execFileAsync(
      getYtDlpBin(),
      args,
      {
        env,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 30,
        timeout: Number(process.env.YT_DLP_TIMEOUT_MS || 180000),
      },
    );

    if (stdout) {
      console.log('🎧 yt-dlp stdout:', stdout);
    }

    if (stderr) {
      console.log('🎧 yt-dlp stderr:', stderr);
    }
  } catch (error) {
    console.error(
      '❌ yt-dlp failed:',
      error?.message || error,
    );

    console.error(
      '❌ yt-dlp stderr:',
      error?.stderr || '',
    );

    throw new Error(
      `yt-dlp failed: ${
        error?.stderr ||
        error?.message ||
        'unknown error'
      }`,
    );
  }

  const files = fs.readdirSync(AUDIO_TEMP_DIR);

  const matched = files.find((file) => {
    return file.startsWith(fileId) && file.endsWith('.mp3');
  });

  if (!matched) {
    throw new Error('Downloaded mp3 file not found');
  }

  const absolutePath = path.join(AUDIO_TEMP_DIR, matched);
  const publicUrl = `${buildBaseUrl()}/uploads/audio-temp/${matched}`;

  console.log('🎧 FINAL filename:', matched);
  console.log('🎧 FINAL absolutePath:', absolutePath);
  console.log('🎧 FINAL publicUrl:', publicUrl);

  const durationMs = await getAudioDurationMs(absolutePath);

  const expiresInMs =
    durationMs > 0
      ? durationMs + AUDIO_DELETE_EXTRA_MS
      : AUDIO_FALLBACK_TTL_MS;

  console.log('🕒 Audio duration ms:', durationMs);
  console.log('🕒 Audio delete extra ms:', AUDIO_DELETE_EXTRA_MS);
  console.log('🕒 Audio will be deleted after ms:', expiresInMs);
  console.log(
    '🕒 Audio will be deleted after minutes:',
    Math.ceil(expiresInMs / 60000),
  );

  scheduleDeleteFile(
    absolutePath,
    expiresInMs,
  );

  return {
    filename: matched,
    absolutePath,
    publicUrl,
    durationMs,
    expiresInMs,
  };
}

export function scheduleDeleteFile(filePath, delayMs) {
  const safeDelayMs = Number(delayMs);

  setTimeout(() => {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error(
          '❌ Failed to delete temp audio:',
          filePath,
          err.message,
        );

        return;
      }

      console.log('🗑️ Temp audio deleted:', filePath);
    });
  }, Number.isFinite(safeDelayMs) && safeDelayMs > 0 ? safeDelayMs : AUDIO_FALLBACK_TTL_MS);
}

export function cleanupExpiredAudioFiles() {
  ensureDirExists(AUDIO_TEMP_DIR);

  const cleanOldFilesMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const files = fs.readdirSync(AUDIO_TEMP_DIR);

  for (const file of files) {
    try {
      const filePath = path.join(AUDIO_TEMP_DIR, file);
      const stat = fs.statSync(filePath);

      if (now - stat.mtimeMs >= cleanOldFilesMs) {
        fs.unlinkSync(filePath);
        console.log('🧹 Removed old audio:', file);
      }
    } catch (error) {
      console.error(
        '❌ Cleanup error for audio file:',
        file,
        error?.message || error,
      );
    }
  }
}