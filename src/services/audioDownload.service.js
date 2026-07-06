const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

/*
  مكان حفظ ملفات الصوت المؤقتة
  الرابط العام سيكون:
  /uploads/audio-temp/file.mp3
*/
const AUDIO_TEMP_DIR = path.join(
  process.cwd(),
  "public",
  "uploads",
  "audio-temp"
);

/*
  حذف الأغنية بعد انتهاء مدتها بدقيقتين
*/
const AUDIO_DELETE_EXTRA_MS = 2 * 60 * 1000;

/*
  احتياطي لو فشل ffprobe في معرفة مدة الأغنية
*/
const AUDIO_FALLBACK_TTL_MS = 10 * 60 * 1000;

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildBaseUrl() {
  const raw =
    process.env.APP_BASE_URL ||
    process.env.BASE_URL ||
    `http://localhost:${process.env.PORT || 5000}`;

  console.log("🌐 buildBaseUrl raw:", raw);

  return String(raw).replace(/\/+$/, "");
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
    const { stdout, stderr } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);

    if (stderr) {
      console.log("⚠️ ffprobe stderr:", stderr);
    }

    const seconds = Number(String(stdout || "").trim());

    if (!Number.isFinite(seconds) || seconds <= 0) {
      console.log("⚠️ Could not detect audio duration, fallback will be used");
      return 0;
    }

    const durationMs = Math.ceil(seconds * 1000);

    console.log("⏱️ Audio duration seconds:", seconds);
    console.log("⏱️ Audio duration ms:", durationMs);

    return durationMs;
  } catch (error) {
    console.error(
      "❌ ffprobe duration error:",
      error && error.message ? error.message : error
    );

    return 0;
  }
}

async function downloadAudioToLocal(params) {
  const sourceUrl = params && params.sourceUrl;

  if (!sourceUrl) {
    throw new Error("sourceUrl is required");
  }

  ensureDirExists(AUDIO_TEMP_DIR);

  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outputTemplate = path.join(AUDIO_TEMP_DIR, `${fileId}.%(ext)s`);

  /*
    نفس فكرة الكود القديم:
    يستخدم cookies.txt حتى لا تظهر مشكلة:
    Sign in to confirm you’re not a bot

    ضع الملف في جذر المشروع:
    BOT-PLUS/cookies.txt

    أو حدد المسار من .env:
    YT_DLP_COOKIES_PATH=/root/BOT-PLUS/cookies.txt
  */
  const cookiesPath =
    process.env.YT_DLP_COOKIES_PATH ||
    process.env.YTDLP_COOKIES_PATH ||
    path.join(process.cwd(), "cookies.txt");

  if (!fileExists(cookiesPath)) {
    throw new Error(`cookies.txt not found at: ${cookiesPath}`);
  }

  const env = {
    ...process.env,
    PATH: `/root/.deno/bin:${process.env.PATH || ""}`,
  };

  const args = [
    "--cookies",
    cookiesPath,

    "--js-runtimes",
    "deno",

    /*
      تحسين بسيط للثبات مع YouTube.
      لو سبب مشكلة عندك احذف السطرين التاليين فقط.
    */
    "--extractor-args",
    "youtube:player_client=web",

    "-f",
    "bestaudio/best",

    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",

    "--no-playlist",
    "--restrict-filenames",

    "--socket-timeout",
    "30",
    "--retries",
    "3",
    "--fragment-retries",
    "3",

    "-o",
    outputTemplate,

    sourceUrl,
  ];

  console.log("🎧 yt-dlp sourceUrl:", sourceUrl);
  console.log("🎧 yt-dlp outputTemplate:", outputTemplate);
  console.log("🍪 yt-dlp cookiesPath:", cookiesPath);
  console.log("🧠 yt-dlp PATH:", env.PATH);
  console.log("🎛️ yt-dlp args:", args);

  try {
    const { stdout, stderr } = await execFileAsync("yt-dlp", args, {
      env,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 30,
      timeout: Number(process.env.YT_DLP_TIMEOUT_MS || 180000),
    });

    if (stdout) {
      console.log("🎧 yt-dlp stdout:", stdout);
    }

    if (stderr) {
      console.log("🎧 yt-dlp stderr:", stderr);
    }
  } catch (error) {
    console.error(
      "❌ yt-dlp failed:",
      error && error.message ? error.message : error
    );

    console.error(
      "❌ yt-dlp stderr:",
      error && error.stderr ? error.stderr : ""
    );

    throw new Error(
      `yt-dlp failed: ${
        (error && error.stderr) ||
        (error && error.message) ||
        "unknown error"
      }`
    );
  }

  const files = fs.readdirSync(AUDIO_TEMP_DIR);

  const matched = files.find((file) => {
    return file.startsWith(fileId) && file.endsWith(".mp3");
  });

  if (!matched) {
    throw new Error("Downloaded mp3 file not found");
  }

  const absolutePath = path.join(AUDIO_TEMP_DIR, matched);
  const publicUrl = `${buildBaseUrl()}/uploads/audio-temp/${matched}`;

  console.log("🎧 FINAL filename:", matched);
  console.log("🎧 FINAL absolutePath:", absolutePath);
  console.log("🎧 FINAL publicUrl:", publicUrl);

  const audioDurationMs = await getAudioDurationMs(absolutePath);

  const deleteAfterMs =
    audioDurationMs > 0
      ? audioDurationMs + AUDIO_DELETE_EXTRA_MS
      : AUDIO_FALLBACK_TTL_MS;

  console.log("🕒 Audio duration ms:", audioDurationMs);
  console.log("🕒 Audio delete extra ms:", AUDIO_DELETE_EXTRA_MS);
  console.log("🕒 Audio will be deleted after ms:", deleteAfterMs);
  console.log(
    "🕒 Audio will be deleted after minutes:",
    Math.ceil(deleteAfterMs / 60000)
  );

  scheduleDeleteFile(absolutePath, deleteAfterMs);

  return {
    filename: matched,
    absolutePath,
    publicUrl,
    durationMs: audioDurationMs,
    expiresInMs: deleteAfterMs,
  };
}

function scheduleDeleteFile(filePath, delayMs) {
  setTimeout(() => {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error("❌ Failed to delete temp audio:", filePath, err.message);
        return;
      }

      console.log("🗑️ Temp audio deleted:", filePath);
    });
  }, delayMs);
}

/*
  تنظيف الملفات القديمة جدًا فقط.
  الحذف الأساسي يتم بعد مدة الأغنية + دقيقتين.
*/
function cleanupExpiredAudioFiles() {
  ensureDirExists(AUDIO_TEMP_DIR);

  const CLEANUP_OLD_FILES_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const files = fs.readdirSync(AUDIO_TEMP_DIR);

  for (const file of files) {
    try {
      const filePath = path.join(AUDIO_TEMP_DIR, file);
      const stat = fs.statSync(filePath);

      if (now - stat.mtimeMs >= CLEANUP_OLD_FILES_MS) {
        fs.unlinkSync(filePath);
        console.log("🧹 Removed old audio:", file);
      }
    } catch (error) {
      console.error(
        "❌ Cleanup error for audio file:",
        file,
        error && error.message ? error.message : error
      );
    }
  }
}

module.exports = {
  AUDIO_TEMP_DIR,
  AUDIO_DELETE_EXTRA_MS,
  AUDIO_FALLBACK_TTL_MS,
  downloadAudioToLocal,
  scheduleDeleteFile,
  cleanupExpiredAudioFiles,
};