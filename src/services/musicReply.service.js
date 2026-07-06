import { execFile } from 'child_process';
import { promisify } from 'util';

import {
  downloadAudioToLocal,
} from './audioDownload.service.js';

const execFileAsync = promisify(execFile);

function normalizeText(value) {
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

export async function searchYoutubeFirstResult(query) {
  const q = normalizeText(query);

  if (!q) {
    return {
      ok: false,
      error: 'Empty search query',
    };
  }

  const env = {
    ...process.env,
    PATH: `/root/.deno/bin:${process.env.PATH || ''}`,
  };

  /*
    بدون cookies نهائيًا.
    يبحث عن أول نتيجة فقط.
  */
  const args = [
    '--no-update',

    '--js-runtimes',
    'deno',

    '--extractor-args',
    'youtube:player_client=android,web',

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
    const errText =
      error?.stderr ||
      error?.message ||
      'yt-dlp search failed';

    return {
      ok: false,
      error: errText,
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
          ? `تعذر العثور على الأغنية: ${yt.error || 'حدث خطأ'}`
          : `Failed to find song: ${yt.error || 'Unknown error'}`,
      meta: {
        action: 'music_search_failed',
        query: parsed.query,
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
        provider: 'yt_dlp_search_no_cookies',

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
          ? `تم العثور على: ${yt.title}\nلكن فشل تجهيز ملف الصوت`
          : `Found: ${yt.title}\nBut failed to prepare the audio file`,
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