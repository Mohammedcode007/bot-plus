import fs from 'fs/promises';
import path from 'path';

const FUN_GAMES_FILE = path.resolve('data/fun-games.json');

function clean(value) {
  return String(value || '').trim();
}

function defaultFunGamesSettings() {
  return {
    enabled: true,
    cooldownSeconds: 300,

    games: {
      trade: {
        enabled: true,
        commands: ['تجارة'],
        title: '📦 تجارة',
        intro: 'دخل صفقة تجارية غريبة...',

        successChance: 35,
        failChance: 35,
        disasterChance: 20,
        nothingChance: 10,

        minPercent: 5,
        maxPercent: 20,
        minChangePoints: 1,
        disasterExtraPercent: 10,

        successTexts: [
          '✅ الصفقة نجحت والبضاعة اتباعت بسعر ممتاز.',
          '✅ السوق كان في صالحك والربح جه بسرعة.',
          '✅ اشتريت بسعر قليل وبعت بسعر عالي.',
          '✅ الزبون دفع من غير فصال، يومك أبيض.',
        ],

        failTexts: [
          '❌ الصفقة خسرت والبضاعة نامت في المخزن.',
          '❌ اشتريت حاجة محدش عايزها.',
          '❌ الزبون فاصل لحد ما كسرك.',
          '❌ السوق وقع عليك والصفقة باظت.',
        ],

        disasterTexts: [
          '🚚 الشحنة ضاعت في الطريق واتحسبت عليك.',
          '📦 البضاعة طلعت مضروبة والناس رجعتها.',
          '🔥 المخزن ولع والربح اتحول لخسارة.',
          '🧾 الضرائب ظهرت فجأة وخدت نص المكسب.',
        ],

        nothingTexts: [
          '😐 السوق كان نايم ومفيش بيع ولا شراء.',
          '🍃 الصفقة اتأجلت لبكرة.',
          '🤷 الزبون قال هيرجع ومارجعش.',
          '📦 فتحت المحل وقفلت زي ما أنت.',
        ],
      },

      auction: {
        enabled: true,
        commands: ['مزاد'],
        title: '🔨 مزاد',
        intro: 'دخل مزاد وهو واثق من نفسه...',

        successChance: 35,
        failChance: 35,
        disasterChance: 20,
        nothingChance: 10,

        minPercent: 5,
        maxPercent: 20,
        minChangePoints: 1,
        disasterExtraPercent: 10,

        successTexts: [
          '✅ كسبت المزاد وطلعت القطعة نادرة.',
          '✅ اشتريت بسعر قليل وبعتها بسعر عالي.',
          '✅ الناس وقفت مزايدة وأنت خطفت الصفقة.',
          '✅ المزاد انتهى لصالحك والربح مضمون.',
        ],

        failTexts: [
          '❌ اشتريت كرسي مكسور بسعر خيالي.',
          '❌ دخلت مزايدة على حاجة ملهاش لازمة.',
          '❌ حد زوّد عليك في آخر ثانية.',
          '❌ اتسرعت ودفعت أكتر من القيمة.',
        ],

        disasterTexts: [
          '🚨 القطعة طلعت مسروقة واتصادرت.',
          '🧾 دفعت رسوم مزاد أكتر من المكسب.',
          '😵 اشتريت صندوق فاضي عليه تراب.',
          '🔨 المزاد كان فخ والتاجر خلع.',
        ],

        nothingTexts: [
          '😐 المزاد اتلغى قبل ما يبدأ.',
          '🤷 محدش زوّد ومحدش اشترى.',
          '🍃 وصلت متأخر والمزاد خلص.',
          '👀 حضرت المزاد واتفرجت بس.',
        ],
      },

      treasure: {
        enabled: true,
        commands: ['كنز'],
        title: '🗺️ كنز',
        intro: 'بدأ رحلة البحث عن الكنز...',

        successChance: 35,
        failChance: 30,
        disasterChance: 25,
        nothingChance: 10,

        minPercent: 5,
        maxPercent: 25,
        minChangePoints: 1,
        disasterExtraPercent: 10,

        successTexts: [
          '✅ وجدت صندوق ذهب مليان نقاط.',
          '✅ الخريطة طلعت حقيقية والكنز كان مستنيك.',
          '✅ حفرت في المكان الصح وطلعت الجائزة.',
          '✅ لقيت كنز مدفون من أيام زمان.',
        ],

        failTexts: [
          '❌ حفرت كتير وطلعت علبة فاضية.',
          '❌ الخريطة كانت مرسومة من طفل صغير.',
          '❌ وصلت للمكان وملقتش غير حجر.',
          '❌ الكنز طلع إشاعة من واحد فاضي.',
        ],

        disasterTexts: [
          '🐍 ثعبان طلع من الحفرة ودفعت علاج.',
          '🕳️ وقعت في حفرة وخسرت جزء من نقاطك.',
          '🏴‍☠️ القراصنة سبقوك وخدوا الكنز.',
          '💣 الكنز كان مفخخ وانفجر في وشك.',
        ],

        nothingTexts: [
          '😐 لقيت ورقة مكتوب عليها: ارجع بكرة.',
          '🍃 الريح طيرت الخريطة.',
          '🤷 فضلت تلف حوالين نفسك.',
          '🪨 لقيت حجر شكله مهم بس طلع عادي.',
        ],
      },

      hacker: {
        enabled: true,
        commands: ['هكر'],
        title: '💻 هكر',
        intro: 'فتح شاشة سوداء وبدأ يكتب أوامر خطيرة...',

        successChance: 35,
        failChance: 35,
        disasterChance: 20,
        nothingChance: 10,

        minPercent: 5,
        maxPercent: 20,
        minChangePoints: 1,
        disasterExtraPercent: 10,

        successTexts: [
          '✅ اخترقت ماكينة النقاط وكسبت.',
          '✅ الكود اشتغل من أول مرة بشكل مريب.',
          '✅ السيستم قالك: ادخل يا معلم.',
          '✅ فتحت خزنة رقمية وطلعت نقاط.',
        ],

        failTexts: [
          '❌ كتبت الباسورد غلط 7 مرات.',
          '❌ الجهاز عمل ريستارت في نص العملية.',
          '❌ نسيت السيمي كولون والسيستم زعل.',
          '❌ الكود طلع منسوخ من منتدى قديم.',
        ],

        disasterTexts: [
          '🚨 السيستم كشفك وعملك غرامة.',
          '🧯 السيرفر سخن واتحسبت عليك الصيانة.',
          '👮 تم تتبعك من خلال كيبورد مضيء.',
          '💣 شغلت ملف اسمه hack.exe وطلع فيروس عليك.',
        ],

        nothingTexts: [
          '😐 الشاشة السوداء فتحت وقفلت لوحدها.',
          '🍃 النت فصل قبل ما تعمل أي حاجة.',
          '🤷 الأمر اشتغل بس مفيش نتيجة.',
          '⌨️ كتبت أوامر كتير وفي الآخر طلعت بتكتب في Notepad.',
        ],
      },

      scam: {
        enabled: true,
        commands: ['نصب'],
        title: '🎭 نصب',
        intro: 'بدأ عملية نصب بثقة عالية...',

        successChance: 35,
        failChance: 35,
        disasterChance: 20,
        nothingChance: 10,

        minPercent: 5,
        maxPercent: 20,
        minChangePoints: 1,
        disasterExtraPercent: 10,

        successTexts: [
          '✅ النصبة عدّت والضحية صدقت القصة.',
          '✅ بعت الوهم بسعر ممتاز.',
          '✅ الخطة كانت مقنعة زيادة عن اللزوم.',
          '✅ الناس صدقت العرض الخرافي.',
        ],

        failTexts: [
          '❌ الضحية طلعت أذكى منك.',
          '❌ القصة كانت مكشوفة من أول سطر.',
          '❌ نسيت اسمك المزيف واتلغبطت.',
          '❌ محدش صدق العرض.',
        ],

        disasterTexts: [
          '🚔 تم الإبلاغ عنك واتعملك غرامة.',
          '📸 الضحية سجلت المكالمة كلها.',
          '👮 الأمن كان متابع من البداية.',
          '🧾 اتقفشت والإيصال كان باسمك الحقيقي.',
        ],

        nothingTexts: [
          '😐 محدش رد عليك أصلًا.',
          '🍃 الرسالة دخلت Spam.',
          '🤷 الضحية قالت هتفكر واختفت.',
          '📵 الرقم اتعمله بلوك فورًا.',
        ],
      },

      wasta: {
        enabled: true,
        commands: ['واسطة', 'واسطه'],
        title: '📞 واسطة',
        intro: 'حاول يشغل واسطة تقيلة...',

        successChance: 35,
        failChance: 35,
        disasterChance: 20,
        nothingChance: 10,

        minPercent: 5,
        maxPercent: 20,
        minChangePoints: 1,
        disasterExtraPercent: 10,

        successTexts: [
          '✅ الواسطة اشتغلت والباب اتفتح فورًا.',
          '✅ المدير قال: عشان خاطر فلان بس.',
          '✅ اسمك اتكتب في أول القائمة.',
          '✅ المكالمة خلصت الموضوع في دقيقة.',
        ],

        failTexts: [
          '❌ الواسطة طلعت ضعيفة.',
          '❌ الشخص المهم مردش على التليفون.',
          '❌ قالك: ابعتلي الورق وبعدين اختفى.',
          '❌ الواسطة قالتلك: معرفكش.',
        ],

        disasterTexts: [
          '🚨 الواسطة طلعت مراقبة واتعملك غرامة.',
          '👮 حاولت تكلم الشخص الغلط.',
          '📞 المكالمة اتسجلت بالكامل.',
          '🧾 اتطلب منك أوراق زيادة وخسرت نقاط.',
        ],

        nothingTexts: [
          '😐 الخط كان مشغول طول اليوم.',
          '🍃 الواسطة نامت قبل ما ترد.',
          '🤷 محدش عرف يساعدك.',
          '📵 الموبايل كان مقفول.',
        ],
      },

      robbery: {
        enabled: true,
        commands: ['سطو'],
        title: '🏦 سطو',
        intro: 'دخل البنك بخطة عبقرية جدًا...',

        successChance: 30,
        failChance: 35,
        disasterChance: 25,
        nothingChance: 10,

        minPercent: 5,
        maxPercent: 25,
        minChangePoints: 1,
        disasterExtraPercent: 15,

        successTexts: [
          '✅ العملية نجحت وخرجت بالنقاط.',
          '✅ الحارس كان نايم والخطة عدّت.',
          '✅ فتحت الخزنة بطريقة عجيبة.',
          '✅ الهروب تم بنجاح والشنطة مليانة.',
        ],

        failTexts: [
          '❌ نسيت الشنطة في البيت.',
          '❌ دخلت البنك في يوم إجازة.',
          '❌ الخزنة طلعت فاضية.',
          '❌ الباب قفل عليك من جوه.',
        ],

        disasterTexts: [
          '🚔 الشرطة قبضت عليك عند الباب.',
          '📸 ابتسمت للكاميرا واتعرفت فورًا.',
          '🚨 الإنذار اشتغل قبل ما تلمس الخزنة.',
          '👮 الحارس طلع بطل كاراتيه.',
        ],

        nothingTexts: [
          '😐 البنك كان مقفول.',
          '🍃 وصلت ونسيت أنت جاي تعمل إيه.',
          '🤷 وقفت في الطابور زي أي عميل.',
          '🏧 استخدمت الـ ATM ومشيت بهدوء.',
        ],
      },
    },
  };
}

async function ensureFunGamesFile() {
  try {
    await fs.mkdir(path.dirname(FUN_GAMES_FILE), {
      recursive: true,
    });

    await fs.access(FUN_GAMES_FILE);
  } catch {
    await fs.writeFile(
      FUN_GAMES_FILE,
      JSON.stringify(defaultFunGamesSettings(), null, 2),
      'utf8',
    );
  }
}

export async function readFunGamesSettings() {
  await ensureFunGamesFile();

  try {
    const raw = await fs.readFile(FUN_GAMES_FILE, 'utf8');
    const data = JSON.parse(raw || '{}');
    const defaults = defaultFunGamesSettings();

    return data && typeof data === 'object'
      ? {
        ...defaults,
        ...data,
        games: {
          ...defaults.games,
          ...(data.games || {}),
        },
      }
      : defaults;
  } catch {
    return defaultFunGamesSettings();
  }
}

function randomInt(min, max) {
  const cleanMin = Number(min);
  const cleanMax = Number(max);

  const safeMin = Number.isFinite(cleanMin) ? cleanMin : 5;
  const safeMax = Number.isFinite(cleanMax) ? cleanMax : 20;

  const from = Math.min(safeMin, safeMax);
  const to = Math.max(safeMin, safeMax);

  return Math.floor(Math.random() * (to - from + 1)) + from;
}

function pickRandomItem(list, fallback) {
  const items = Array.isArray(list)
    ? list.map(clean).filter(Boolean)
    : [];

  if (items.length === 0) {
    return fallback;
  }

  const index = Math.floor(Math.random() * items.length);

  return items[index];
}

export async function getFunGamesCooldownSeconds() {
  const settings = await readFunGamesSettings();

  return Number(settings.cooldownSeconds) || 300;
}

export async function findFunGameByCommand(command) {
  const settings = await readFunGamesSettings();

  if (settings.enabled !== true) {
    return {
      ok: false,
      reason: 'disabled',
      settings,
      gameKey: '',
      game: null,
    };
  }

  const cleanCommand = clean(command);

  const games = settings.games && typeof settings.games === 'object'
    ? settings.games
    : {};

  for (const [gameKey, game] of Object.entries(games)) {
    if (!game || typeof game !== 'object') {
      continue;
    }

    if (game.enabled !== true) {
      continue;
    }

    const commands = Array.isArray(game.commands)
      ? game.commands.map(clean).filter(Boolean)
      : [];

    if (commands.includes(cleanCommand)) {
      return {
        ok: true,
        reason: '',
        settings,
        gameKey,
        game,
      };
    }
  }

  return {
    ok: false,
    reason: 'not_found',
    settings,
    gameKey: '',
    game: null,
  };
}

export async function rollFunGameResult({
  game,
  currentPoints,
}) {
  if (!game || typeof game !== 'object') {
    return {
      ok: false,
      type: 'missing_game',
      points: 0,
      percent: 0,
      text: '',
      message: 'Game settings not found.',
    };
  }

  if (game.enabled !== true) {
    return {
      ok: false,
      type: 'disabled',
      points: 0,
      percent: 0,
      text: '',
      message: 'Game is disabled.',
    };
  }

  const safePoints = Math.max(
    0,
    Number(currentPoints) || 0,
  );

  const successChance = Number(game.successChance) || 35;
  const failChance = Number(game.failChance) || 35;
  const disasterChance = Number(game.disasterChance) || 20;
  const nothingChance = Number(game.nothingChance) || 10;

  const totalChance = Math.max(
    1,
    successChance + failChance + disasterChance + nothingChance,
  );

  const roll = Math.random() * totalChance;

  const percent = randomInt(
    Number(game.minPercent) || 5,
    Number(game.maxPercent) || 20,
  );

  const minChangePoints = Math.max(
    1,
    Number(game.minChangePoints) || 1,
  );

  const calculatedPoints = Math.max(
    minChangePoints,
    Math.floor((safePoints * percent) / 100),
  );

  if (roll < successChance) {
    return {
      ok: true,
      type: 'success',
      points: calculatedPoints,
      percent,
      text: pickRandomItem(
        game.successTexts,
        '✅ نجحت المحاولة.',
      ),
    };
  }

  if (roll < successChance + failChance) {
    const lossPoints = Math.min(
      safePoints,
      calculatedPoints,
    );

    return {
      ok: true,
      type: 'fail',
      points: -lossPoints,
      percent,
      text: pickRandomItem(
        game.failTexts,
        '❌ فشلت المحاولة.',
      ),
    };
  }

  if (roll < successChance + failChance + disasterChance) {
    const extraPercent = Math.max(
      0,
      Number(game.disasterExtraPercent) || 10,
    );

    const disasterPercent = percent + extraPercent;

    const disasterPoints = Math.max(
      minChangePoints,
      Math.floor((safePoints * disasterPercent) / 100),
    );

    const lossPoints = Math.min(
      safePoints,
      disasterPoints,
    );

    return {
      ok: true,
      type: 'disaster',
      points: -lossPoints,
      percent: disasterPercent,
      text: pickRandomItem(
        game.disasterTexts,
        '🚨 حصلت مصيبة وخسرت نقاط.',
      ),
    };
  }

  return {
    ok: true,
    type: 'nothing',
    points: 0,
    percent: 0,
    text: pickRandomItem(
      game.nothingTexts,
      '😐 لا شيء حدث.',
    ),
  };
}