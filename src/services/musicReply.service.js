import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import {
  downloadAudioToLocal,
} from './audioDownload.service.js';

const execFileAsync = promisify(execFile);

export function normalizeText(value) {
  return String(value || '').trim();
}

export function parsePlayCommand(raw) {
  const text = normalizeText(raw);
  const lower = text.toLowerCase();

  if (lower.startsWith('play ')) {
    return {
      matched: true,
      query: text.slice('play '.length).trim(),
      lang: 'en',
    };
  }

  if (text.startsWith('تشغيل ')) {
    return {
      matched: true,
      query: text.slice('تشغيل '.length).trim(),
      lang: 'ar',
    };
  }

  return {
    matched: false,
    query: '',
    lang: 'ar',
  };
}

function makeSafeFileName(value) {
  return String(value || 'audio')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export async function searchYoutubeFirstResult(query) {
  const q = normalizeText(query);

  if (!q) {
    return {
      ok: false,
      error: 'Empty search query',
    };
  }

  const cookiesPath =
    process.env.YT_DLP_COOKIES_PATH ||
    process.env.YTDLP_COOKIES_PATH ||
    path.join(process.cwd(), 'cookies.txt');

  if (!fileExists(cookiesPath)) {
    return {
      ok: false,
      error: `cookies.txt not found at: ${cookiesPath}`,
    };
  }

  const env = {
    ...process.env,
    PATH: `/root/.deno/bin:${process.env.PATH || ''}`,
  };

  const args = [
    '--cookies',
    cookiesPath,

    '--js-runtimes',
    'deno',

    '--extractor-args',
    'youtube:player_client=web',

    '--dump-single-json',
    '--skip-download',
    '--no-playlist',

    '--socket-timeout',
    '30',
    '--retries',
    '3',

    `ytsearch1:${q}`,
  ];

  try {
    console.log('🔎 yt-dlp search query:', q);
    console.log('🍪 yt-dlp search cookiesPath:', cookiesPath);
    console.log('🔎 yt-dlp search args:', args);

    const { stdout, stderr } = await execFileAsync(
      'yt-dlp',
      args,
      {
        env,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 20,
        timeout: Number(process.env.YT_DLP_SEARCH_TIMEOUT_MS || 60000),
      },
    );

    if (stderr) {
      console.log('🔎 yt-dlp search stderr:', stderr);
    }

    const data = JSON.parse(String(stdout || '{}'));

    const item =
      Array.isArray(data.entries) && data.entries.length
        ? data.entries[0]
        : data;

    if (!item) {
      return {
        ok: false,
        error: 'No YouTube results found',
      };
    }

    const title = String(item.title || q).trim();

    const youtubeUrl =
      item.webpage_url ||
      item.original_url ||
      (item.id ? `https://www.youtube.com/watch?v=${item.id}` : '');

    if (!youtubeUrl) {
      return {
        ok: false,
        error: 'YouTube URL not found',
      };
    }

    return {
      ok: true,
      title,
      youtubeUrl,
      videoId: item.id || '',
      channelTitle: item.channel || item.uploader || '',
      thumbnail:
        item.thumbnail ||
        (
          Array.isArray(item.thumbnails) && item.thumbnails.length
            ? item.thumbnails[item.thumbnails.length - 1].url
            : ''
        ),
      duration: item.duration || 0,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error?.stderr ||
        error?.message ||
        'yt-dlp search failed',
    };
  }
}

export async function buildMusicReply(rawText, extra = {}) {
  const parsed = parsePlayCommand(rawText);

  if (!parsed.matched) {
    return {
      handled: false,
    };
  }

  if (!parsed.query) {
    return {
      handled: true,
      success: false,
      text:
        parsed.lang === 'ar'
          ? 'اكتب اسم الأغنية بعد الأمر'
          : 'Write the song name after the command',
    };
  }

  const yt = await searchYoutubeFirstResult(parsed.query);

  if (!yt.ok || !yt.youtubeUrl) {
    return {
      handled: true,
      success: false,
      text:
        parsed.lang === 'ar'
          ? 'تعذر تشغيل الأغنية الآن. جرّب اسم أغنية آخر.'
          : 'Could not play this song now. Try another song.',
      meta: {
        action: 'music_search_failed',
        query: parsed.query,
        error: yt.error || '',
        requestedBy: extra.requestedBy || '',
        roomName: extra.roomName || '',
      },
    };
  }

  try {
    const safeTitle = makeSafeFileName(
      yt.title || parsed.query || 'audio',
    );

    const saved = await downloadAudioToLocal({
      sourceUrl: yt.youtubeUrl,
      filename: `${safeTitle}.mp3`,
    });

    return {
      handled: true,
      success: true,
      text: [
        '🎵 تم تجهيز الأغنية',
        `الاسم: ${yt.title || parsed.query}`,
        `بواسطة: ${extra.requestedBy || 'unknown'}`,
        `الغرفة: ${extra.roomName || 'unknown'}`,
        `الرابط: ${saved.publicUrl}`,
      ].join('\n'),
      meta: {
        action: 'music_mp3_ready',
        query: parsed.query,

        youtubeTitle: yt.title || parsed.query,
        youtubeUrl: yt.youtubeUrl,
        thumbnail: yt.thumbnail,
        channelTitle: yt.channelTitle,

        mp3Url: saved.publicUrl,
        publicUrl: saved.publicUrl,
        audioUrl: saved.publicUrl,
        filename: saved.filename,
        durationMs: saved.durationMs || 0,
        expiresInMs: saved.expiresInMs,
        provider: 'yt_dlp_search',

        requestedBy: extra.requestedBy || '',
        roomName: extra.roomName || '',
      },
    };
  } catch (error) {
    return {
      handled: true,
      success: false,
      text:
        parsed.lang === 'ar'
          ? `تم العثور على: ${yt.title}\nلكن تعذر تجهيز ملف الصوت الآن.`
          : `Found: ${yt.title}\nBut could not prepare the audio file now.`,
      meta: {
        action: 'music_prepare_failed',
        query: parsed.query,
        youtubeTitle: yt.title,
        youtubeUrl: yt.youtubeUrl,
        error: error?.message || 'unknown_error',
      },
    };
  }
}