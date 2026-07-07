import yts from 'yt-search';
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

function makeYtDlpEnv() {
  return {
    ...process.env,
    PATH: `/root/.deno/bin:${process.env.PATH || ''}`,
  };
}

function normalizeYoutubeVideo(video, query, provider) {
  if (!video) {
    return null;
  }

  const videoId =
    video?.videoId ||
    video?.id ||
    '';

  const youtubeUrl =
    video?.url ||
    video?.webpage_url ||
    video?.original_url ||
    (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');

  if (!youtubeUrl) {
    return null;
  }

  const finalVideoId =
    videoId ||
    String(youtubeUrl).match(/[?&]v=([^&]+)/)?.[1] ||
    '';

  return {
    ok: true,
    title: video?.title || query,
    youtubeUrl,
    videoId: finalVideoId,
    channelTitle:
      video?.author?.name ||
      video?.author ||
      video?.channelTitle ||
      video?.uploader ||
      video?.channel ||
      '',
    thumbnail:
      video?.thumbnail ||
      video?.image ||
      video?.thumbnails?.[video?.thumbnails.length - 1]?.url ||
      (finalVideoId ? `https://i.ytimg.com/vi/${finalVideoId}/hqdefault.jpg` : ''),
    duration:
      video?.seconds ||
      video?.duration?.seconds ||
      video?.duration ||
      0,
    provider,
  };
}

/*
  البحث الأساسي: yt-search.
  البحث الاحتياطي: yt-dlp ytsearch1 بدون cookies وبدون YouTube API.
*/
async function searchByYtSearchLibrary(query) {
  console.log('🔎 yt-search query:', query);

  const result = await yts(query);

  const videos = Array.isArray(result?.videos)
    ? result.videos
    : [];

  const firstVideo = videos.find((video) => {
    return video && (video.url || video.videoId) && video.title;
  });

  return normalizeYoutubeVideo(
    firstVideo,
    query,
    'yt_search_library',
  );
}

async function searchByYtDlpSearch(query) {
  const env = makeYtDlpEnv();

  const args = [
    '--no-update',

    '--js-runtimes',
    'deno',

    '--extractor-args',
    'youtube:player_client=android,web',

    '--no-playlist',
    '--skip-download',

    '--dump-single-json',

    '--socket-timeout',
    '30',

    '--retries',
    '2',

    `ytsearch1:${query}`,
  ];

  console.log('🔎 yt-dlp search query:', query);
  console.log('🎛️ yt-dlp search args:', args);

  const { stdout, stderr } = await execFileAsync(
    'yt-dlp',
    args,
    {
      env,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
      timeout: Number(process.env.YT_DLP_SEARCH_TIMEOUT_MS || 90000),
    },
  );

  if (stderr) {
    console.log('🔎 yt-dlp search stderr:', stderr);
  }

  const raw = String(stdout || '').trim();

  if (!raw) {
    throw new Error('yt-dlp search returned empty stdout');
  }

  const json = JSON.parse(raw);

  return normalizeYoutubeVideo(
    json,
    query,
    'yt_dlp_search_no_cookies',
  );
}

async function searchByYoutubeHtmlFallback(query) {
  const searchUrl =
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  console.log('🔎 youtube html fallback:', searchUrl);

  const response = await fetch(searchUrl, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`YouTube html status ${response.status}`);
  }

  const html = await response.text();

  const videoIds = [
    ...html.matchAll(/"videoId":"([^"]{11})"/g),
  ]
    .map((match) => match[1])
    .filter(Boolean);

  const uniqueVideoIds = Array.from(new Set(videoIds));
  const videoId = uniqueVideoIds[0];

  if (!videoId) {
    return null;
  }

  let title = query;

  const titleMatch = html.match(
    new RegExp(`"videoId":"${videoId}"[\\s\\S]{0,2000}?"title":\\{"runs":\\[\\{"text":"([^"]+)"`)
  );

  if (titleMatch?.[1]) {
    title = titleMatch[1]
      .replace(/\\u0026/g, '&')
      .replace(/\\"/g, '"');
  }

  return {
    ok: true,
    title,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
    channelTitle: '',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: 0,
    provider: 'youtube_html_fallback_no_cookies',
  };
}

export async function searchYoutubeFirstResult(query) {
  const q = normalizeText(query);

  if (!q) {
    return {
      ok: false,
      error: 'Empty search query',
    };
  }

  const errors = [];

  try {
    const result = await searchByYtSearchLibrary(q);

    if (result?.ok && result.youtubeUrl) {
      return result;
    }

    errors.push('yt-search returned no valid video');
  } catch (error) {
    const message = error?.message || String(error);
    console.log('❌ yt-search failed:', message);
    errors.push(`yt-search: ${message}`);
  }

  try {
    const result = await searchByYtDlpSearch(q);

    if (result?.ok && result.youtubeUrl) {
      return result;
    }

    errors.push('yt-dlp search returned no valid video');
  } catch (error) {
    const message = error?.message || String(error);
    console.log('❌ yt-dlp search failed:', message);
    console.log('❌ yt-dlp search stderr:', error?.stderr || '');
    errors.push(`yt-dlp-search: ${error?.stderr || message}`);
  }

  try {
    const result = await searchByYoutubeHtmlFallback(q);

    if (result?.ok && result.youtubeUrl) {
      return result;
    }

    errors.push('youtube html fallback returned no video');
  } catch (error) {
    const message = error?.message || String(error);
    console.log('❌ youtube html fallback failed:', message);
    errors.push(`html-fallback: ${message}`);
  }

  return {
    ok: false,
    error: errors.join(' | ') || 'No YouTube results found',
  };
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
          ? `تعذر العثور على نتيجة مناسبة.\n${yt.error || ''}`.trim()
          : `Could not find a suitable result.\n${yt.error || ''}`.trim(),
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

        provider: yt.provider || 'unknown_no_cookies',

        requestedBy: extra.requestedBy || '',
        roomName: extra.roomName || '',
      },
    };
  } catch (error) {
    console.log('❌ [MUSIC_PREPARE_FAILED]', {
      query: parsed.query,
      youtubeTitle: yt.title,
      youtubeUrl: yt.youtubeUrl,
      provider: yt.provider,
      error: error?.message || error,
    });

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
        provider: yt.provider,
        error: error?.message || 'unknown_error',
      },
    };
  }
}