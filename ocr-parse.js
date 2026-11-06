/*
 * SNS 記録帳：スクショの文字から数字を拾う部分
 * 文字認識（Tesseract.js）が返した文字列を受け取り、X・Threads・note の画面に
 * 出ている数字を、記録帳の項目（フォロワー、インプレッションなど）に振り分けます。
 * ブラウザと Node.js の両方で使えるようにしています。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SNSParse = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 項目ごとの見出し。長いものから順に探します。
  const KEYS = {
    x: {
      impressions: ['インプレッション', 'impressions', '表示回数', 'インプ'],
      engagement: ['エンゲージメント', 'engagements', 'engagement'],
      followers: ['フォロワー', 'followers'],
      posts: ['ポスト数', '投稿数', 'posts'],
    },
    threads: {
      impressions: ['閲覧数', 'views', 'ビュー', 'インプレッション'],
      engagement: ['インタラクション', 'interactions'],
      followers: ['フォロワー', 'followers'],
      posts: ['投稿数', 'posts'],
    },
    note: {
      pv: ['全体ビュー', 'ビュー', 'views', 'pv'],
      impressions: ['インプレッション', 'impressions'],
      likes: ['スキ', 'likes'],
      followers: ['フォロワー', 'followers'],
      comments: ['コメント', 'comments'],
    },
  };

  // 見出しに付いていたら、その項目の数字ではないもの（率、フォロー中など）
  const EXCLUDE = ['率', 'rate', '%', 'フォロー中', 'following', '平均', 'あたり'];

  const DETECT = {
    x: [['エンゲージメント', 2], ['インプレッション', 1], ['ポスト', 1], ['アナリティクス', 1], ['プロフィールへのアクセス', 2], ['リンクのクリック数', 2]],
    threads: [['閲覧数', 2], ['インタラクション', 3], ['threads', 3], ['スレッズ', 3], ['リポスト', 1], ['引用', 1]],
    note: [['スキ', 3], ['全体ビュー', 3], ['note', 2], ['ダッシュボード', 1], ['コメント', 1], ['記事', 1]],
  };

  const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f';

  function normalize(text) {
    return String(text || '')
      .normalize('NFKC')
      .replace(/\r/g, '')
      .replace(/[ \t　]+/g, ' ')
      // 文字認識で入りがちな、日本語の文字の間のすき間を詰める
      .replace(new RegExp(`([${CJK}]) (?=[${CJK}])`, 'g'), '$1')
      // 数字の途中のすき間（"1 245" や "1, 245"）を詰める
      .replace(/(\d)[ ,](?=\d{3}\b)/g, '$1,')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const NUM = /([+\-−]?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(万|千|[kKmM](?![a-zA-Z]))?/g;

  // 1 行から数字を拾う。日付・時刻・割合・増減は外します。
  function numbersIn(line) {
    const out = [];
    NUM.lastIndex = 0;
    let m;
    while ((m = NUM.exec(line))) {
      const start = m.index;
      const end = start + m[0].length;
      const before = line.slice(Math.max(0, start - 1), start);
      const after = line.slice(end).trimStart();
      const sign = m[1];
      if (/[\d/:.%]/.test(before)) continue;
      if (/^[%/:年月日時分秒]/.test(after)) continue;
      if (/^(?:日前|時間|分前|週間|か月|ヶ月)/.test(after)) continue;
      let value = Number(m[2].replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      const unit = m[3];
      if (unit === '万') value *= 10000;
      else if (unit === '千') value *= 1000;
      else if (unit === 'k' || unit === 'K') value *= 1000;
      else if (unit === 'm' || unit === 'M') value *= 1000000;
      out.push({ value: Math.round(value), start, end, delta: !!sign, raw: m[0].trim() });
    }
    return out;
  }

  function findKey(line, words) {
    const lower = line.toLowerCase();
    for (const word of words) {
      const i = lower.indexOf(word.toLowerCase());
      if (i >= 0) return { index: i, word };
    }
    return null;
  }

  function detect(lines) {
    const all = lines.join('\n').toLowerCase();
    let best = null;
    let bestScore = 0;
    let second = 0;
    for (const [platform, rules] of Object.entries(DETECT)) {
      const score = rules.reduce((s, [word, w]) => {
        const hit = /^[a-z]+$/i.test(word)
          // 英単語は単独の語のときだけ（@flaw_note のような ID の一部は数えない）
          ? new RegExp(`(^|[^a-z0-9_@.])${word}(?![a-z0-9_])`, 'i').test(all)
          : all.includes(word.toLowerCase());
        return s + (hit ? w : 0);
      }, 0);
      if (score > bestScore) { second = bestScore; bestScore = score; best = platform; }
      else if (score > second) second = score;
    }
    return bestScore >= 2 && bestScore > second ? best : null;
  }

  function parse(text, platformHint) {
    const lines = normalize(text);
    const detected = detect(lines);
    const platform = platformHint && KEYS[platformHint] ? platformHint : detected;

    // 画面に出ている数字すべて（候補として表示する）
    const numbers = [];
    const clean = (str) => str.replace(/[\d,.+\-−%/:：()（）_|=~・*#\s]+/g, ' ').trim();
    const wordy = (str) => new RegExp(`[${CJK}A-Za-z]{2,}`).test(str);
    lines.forEach((line, i) => {
      numbersIn(line).forEach((n) => {
        if (n.delta) return;
        let label = clean(line.slice(0, n.start)).slice(-10);
        if (!wordy(label)) {
          // 見出しが上の行にある画面：数字と同じ位置あたりの文字を使う
          const prev = lines[i - 1];
          label = '';
          if (prev && !numbersIn(prev).length) {
            const at = Math.round((n.start / Math.max(1, line.length)) * prev.length);
            const piece = clean(prev.slice(Math.max(0, at - 2), at + 8));
            if (wordy(piece)) label = piece;
          }
        }
        numbers.push({ value: n.value, raw: n.raw, label, line: i });
      });
    });

    const values = {};
    if (!platform) return { platform: null, detected, values, numbers, lines };

    const keys = KEYS[platform];
    const used = new Set();
    const take = (field, n, i) => {
      if (values[field] !== undefined || !n) return false;
      const id = `${i}:${n.start}`;
      if (used.has(id)) return false;
      used.add(id);
      values[field] = n.value;
      return true;
    };
    const usable = (line) => numbersIn(line).filter((n) => !n.delta);
    const anyKeyIn = (line) => Object.values(keys).some((words) => findKey(line, words));

    // 1) 見出しが横に並び、次の行に数字が同じ順で並ぶ表（例: ビュー コメント スキ / 73 0 5）
    lines.forEach((line, i) => {
      const hits = Object.entries(keys)
        .map(([field, words]) => ({ field, hit: findKey(line, words) }))
        .filter((h) => h.hit)
        .sort((a, b) => a.hit.index - b.hit.index);
      if (hits.length < 2 || usable(line).length) return;
      const next = lines[i + 1];
      if (!next) return;
      const nums = usable(next);
      if (nums.length !== hits.length) return;
      hits.forEach((h, k) => take(h.field, nums[k], i + 1));
    });

    // 2) 見出しの横、または下の行の数字
    for (const [field, words] of Object.entries(keys)) {
      for (let i = 0; i < lines.length && values[field] === undefined; i += 1) {
        const line = lines[i];
        const hit = findKey(line, words);
        if (!hit) continue;
        const rest = line.slice(hit.index + hit.word.length);
        if (EXCLUDE.some((w) => rest.toLowerCase().startsWith(w) || line.toLowerCase().includes(`${hit.word.toLowerCase()}${w}`))) continue;
        const afterNums = usable(line).filter((n) => n.start >= hit.index + hit.word.length);
        const beforeNums = usable(line).filter((n) => n.end <= hit.index);
        if (afterNums.length && take(field, afterNums[0], i)) break;
        if (beforeNums.length && take(field, beforeNums[beforeNums.length - 1], i)) break;
        // 見出しのすぐ下（1〜2行）。他の見出しの行は飛ばさない。
        // 横に並んだカードでは、見出しと同じ位置（左・右）にある数字を選びます。
        for (let j = i + 1; j <= i + 2 && j < lines.length; j += 1) {
          const nums = usable(lines[j]);
          if (nums.length) {
            let pick = nums[0];
            if (nums.length > 1) {
              const at = hit.index / Math.max(1, line.length);
              pick = nums.reduce((best, n) => (
                Math.abs(n.start / lines[j].length - at) < Math.abs(best.start / lines[j].length - at) ? n : best
              ), nums[0]);
            }
            take(field, pick, j);
            break;
          }
          if (anyKeyIn(lines[j])) break;
        }
        // 数字が見出しの上にある画面（例: 81 / フォロワー）
        if (values[field] === undefined && i > 0 && !anyKeyIn(lines[i - 1])) {
          const nums = usable(lines[i - 1]);
          if (nums.length === 1) take(field, nums[0], i - 1);
        }
      }
    }

    delete values.comments;
    return { platform, detected, values, numbers, lines };
  }

  return { parse, normalize, numbersIn, detect, KEYS };
}));
