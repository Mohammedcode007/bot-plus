import yts from 'yt-search';

import {
  downloadAudioToLocal,
} from './audioDownload.service.js';

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

/*
  البحث عن أول فيديو باستخدام مكتبة yt-search.
  بدون cookies
  بدون YouTube API
  بدون yt-dlp في مرحلة البحث
*/
export async function searchYoutubeFirstResult(query) {
  const q = normalizeText(query);

  if (!q) {
    return {
      ok: false,
      error: 'Empty search query',
    };
  }

  try {
    console.log('🔎 yt-search query:', q);

    const result = await yts(q);

    const videos = Array.isArray(result?.videos)
      ? result.videos
      : [];

    const firstVideo = videos.find((video) => {
      return video && video.url && video.title;
    });

    if (!firstVideo) {
      return {
        ok: false,
        error: 'No YouTube results found',
      };
    }

    return {
      ok: true,
      title: firstVideo.title || q,
      youtubeUrl: firstVideo.url,
      videoId: firstVideo.videoId || '',
      channelTitle:
        firstVideo.author?.name ||
        firstVideo.author ||
        '',
      thumbnail:
        firstVideo.thumbnail ||
        firstVideo.image ||
        '',
      duration:
        firstVideo.seconds ||
        firstVideo.duration?.seconds ||
        0,
      provider: 'yt_search_library',
    };
  } catch (error) {
    console.log('❌ yt-search failed:', error?.message || error);

    return {
      ok: false,
      error:
        error?.message ||
        'yt-search failed',
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
          ? 'تعذر العثور على نتيجة مناسبة.'
          : 'Could not find a suitable result.',
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

    /*
      هنا التحميل بدون cookies.
      البحث تم بالمكتبة، والتحميل من رابط أول نتيجة.
    */
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

        provider: 'yt_search_library_no_cookies',

        requestedBy: extra.requestedBy || '',
        roomName: extra.roomName || '',
      },
    };
  } catch (error) {
    console.log('❌ [MUSIC_PREPARE_FAILED]', {
      query: parsed.query,
      youtubeTitle: yt.title,
      youtubeUrl: yt.youtubeUrl,
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
        error: error?.message || 'unknown_error',
      },
    };
  }
}