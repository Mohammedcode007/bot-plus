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

  return String(raw).replace(/\/+$/, '');
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
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
      return 0;
    }

    return Math.ceil(seconds * 1000);
  } catch (error) {
    console.log(
      '⚠️ ffprobe duration failed:',
      error?.message || error,
    );

    return 0;
  }
}

export async function downloadAudioToLocal(params) {
  const sourceUrl = params?.sourceUrl;

  if (!sourceUrl) {
    throw new Error('sourceUrl is required');
  }

  ensureDirExists(AUDIO_TEMP_DIR);

  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputTemplate = path.join(AUDIO_TEMP_DIR, `${fileId}.%(ext)s`);

  const cookiesPath =
    process.env.YT_DLP_COOKIES_PATH ||
    process.env.YTDLP_COOKIES_PATH ||
    path.join(process.cwd(), 'cookies.txt');

  const env = {
    ...process.env,
    PATH: process.env.PATH || '',
  };

  const args = [
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
    '3',
    '--fragment-retries',
    '3',

    '-o',
    outputTemplate,

    sourceUrl,
  ];

  if (fileExists(cookiesPath)) {
    args.unshift(
      '--cookies',
      cookiesPath,
    );
  }

  console.log('🎧 yt-dlp sourceUrl:', sourceUrl);
  console.log('🎧 yt-dlp outputTemplate:', outputTemplate);
  console.log('🎧 yt-dlp cookiesPath:', fileExists(cookiesPath) ? cookiesPath : 'not_found');
  console.log('🎧 yt-dlp args:', args);

  try {
    const { stdout, stderr } = await execFileAsync(
      'yt-dlp',
      args,
      {
        env,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 20,
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
  }, delayMs);
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