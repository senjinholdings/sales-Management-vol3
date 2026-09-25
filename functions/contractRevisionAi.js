const OpenAI = require('openai');

// 案件ごとの契約書をAIに直してもらうときの、AIへの頼み方と返事の受け取り方。
//
// ここを独立させているのは、この機能の正しさが「プロンプト」と「返事を座標に直す処理」に
// 集中しているため。ルーター（contractsRouter.js）の中に混ぜるとテストできない。
//
// 一番大事な設計の判断:
// **直す単位は「選んだ範囲」ではなく「契約書全体」にする。**
// 最初は「選んだ範囲をこう直して」という作りにしていたが、それでは
// 「支払条件を前払いから月末払いに変える」のような指示に対して、選んだ料金条項だけが
// 直り、別の場所にある支払条件の条項が前払いのまま残る（実際にそうなった）。
// 同じ事柄が契約書の複数の場所に書かれているのは例外ではなく普通なので、
// 「関係する箇所を全部挙げさせる」形でないと、矛盾した契約書が必ずできる。
//
// そのためにAIには行番号を振った全文を渡し、「直す行の範囲」を番号で返させる。
// 元の文言そのものを返させると言い換えが混じって場所を特定できなくなるが、
// 番号なら取り違えようがなく、元のテキストはこちら側で切り出せる。

// 使うモデル。契約書の整合性を見る仕事なので安いモデルには落とさない。
// 変えるときはここ1箇所でよい。
const REVISION_MODEL = 'gpt-4o';

// 行に分ける。改行を行末に残したまま分けるので、連結すると必ず元の文字列に戻る
// （＝行番号から文字位置への変換が単純な足し算で済む）。src/utils/textDiff.js と同じ考え方。
function splitLines(text) {
  return String(text == null ? '' : text).match(/[^\n]*\n|[^\n]+/g) || [];
}

function numberLines(lines) {
  return lines.map((line, index) => `${index + 1}: ${line.replace(/\n$/, '')}`).join('\n');
}

// 「この契約の前提」を、AIに渡す1つのかたまりに整える。
// 案件に入っている事実と、契約書を作るときに差し込んだ項目の値。
function formatFacts(facts) {
  const rows = (Array.isArray(facts) ? facts : [])
    .filter((f) => f && f.label && f.value != null && String(f.value).trim())
    .map((f) => `- ${f.label}（${f.source || '不明'}）: ${String(f.value).trim()}`);
  return rows.length > 0 ? rows.join('\n') : '（システムに登録されている前提はありません）';
}

// 行番号（1始まり・endLineを含む）を、フラットテキスト上の[flatStart, flatEnd)に直す。
function lineRangeToFlatRange(lines, startLine, endLine) {
  const offsets = [0];
  lines.forEach((line, index) => { offsets[index + 1] = offsets[index] + line.length; });
  return { flatStart: offsets[startLine - 1], flatEnd: offsets[endLine] };
}

// AIの返事を、そのまま画面に出せる形に整える。
// AIは行番号を間違えることがある（範囲が逆・行数を超える・箇所どうしが重なる）ので、
// ここで弾く。黙って捨てると「直したつもりで直っていない」になるため、
// 弾いたものは warnings に理由を足して人に見えるようにする。
function normalizeEdits(rawEdits, lines) {
  const warnings = [];
  const candidates = [];
  for (const raw of Array.isArray(rawEdits) ? rawEdits : []) {
    if (!raw || typeof raw !== 'object') continue;
    const startLine = Number(raw.startLine);
    const endLine = Number(raw.endLine != null ? raw.endLine : raw.startLine);
    const reason = raw.reason != null ? String(raw.reason).trim() : '';
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)
      || startLine < 1 || endLine < startLine || endLine > lines.length) {
      warnings.push(`AIが返した行番号（${raw.startLine}〜${raw.endLine}）が契約書の行と合わなかったため、この提案は採用していません${reason ? `：${reason}` : ''}`);
      continue;
    }
    const { flatStart, flatEnd } = lineRangeToFlatRange(lines, startLine, endLine);
    const original = lines.slice(startLine - 1, endLine).join('');
    // 行の区切り（改行）は元のまま保つ。AIが末尾の改行を落として返すことがあり、
    // そのまま当てると行がくっついてしまう。
    let replace = raw.replace != null ? String(raw.replace) : '';
    if (original.endsWith('\n') && !replace.endsWith('\n')) replace += '\n';
    if (replace === original) continue;
    candidates.push({ startLine, endLine, flatStart, flatEnd, original, replace, reason });
  }

  // 箇所どうしが重なっていると、当てた結果がどうなるか決まらない。前から順に見て、
  // 重なったほうを落とす（落としたことは人に見せる）。
  candidates.sort((a, b) => a.flatStart - b.flatStart);
  const edits = [];
  for (const candidate of candidates) {
    const previous = edits[edits.length - 1];
    if (previous && candidate.flatStart < previous.flatEnd) {
      warnings.push(`${candidate.startLine}行目の提案が${previous.startLine}行目の提案と範囲が重なっていたため、採用していません`);
      continue;
    }
    edits.push(candidate);
  }
  return { edits, warnings };
}

function parseJsonReply(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

const EDIT_SYSTEM_PROMPT = [
  'あなたは日本語の契約書を直す担当者です。行番号付きの契約書の全文、この契約の前提、直したい内容の指示が与えられます。',
  '指示を反映するために書き換える必要がある行を「すべて」挙げてください。',
  '',
  '■ 漏れを出さないこと',
  '- 同じ事柄が契約書の複数の場所に書かれているのが普通です（例：料金の条項と支払条件の条項の両方に支払時期が書かれている、本文と別表の両方に金額が書かれている、前文や頭書きにも同じ条件が出てくる）。',
  '- 1箇所だけ直すと、互いに矛盾した契約書になります。必ず全文を最後まで読み、指示に関係する箇所を漏れなく挙げてください。',
  '- 直接その言葉が書かれていなくても、指示を反映すると辻褄が合わなくなる行（期日の起算日、遅延損害金の起算、検収と支払の順序など）があれば、それも挙げてください。',
  '',
  '■ 分からないことを勝手に決めないこと（ここが最も事故になります）',
  '指示の文だけでは決まらないことがあります。前提に答えが書かれていないなら、推測で書かずに questions に質問として出してください。',
  'とくに次は、指示の言葉からは決まらないのに、決め方ひとつで請求が1回増えたり減ったりします。必ず前提を確認し、確認できないなら質問にしてください。',
  '- 支払いの回数：一括で1回なのか、期間中は毎月なのか。',
  '  （実例：「9月末締め翌月末払いにして」という指示に対し、一括のパッケージ料金なのに「毎月末日を締め日とし翌月末日までに支払う」と書いてしまい、実施していない月にも請求が立つ文面になりかけた）',
  '- 起算日：契約締結日からか、実施開始日からか、検収日からか。',
  '- 対象期間：実施期間と請求対象期間が一致するのか、ずれるのか。',
  '- 回数が決まっている場合、その総額と1回あたりの額の関係。',
  '質問を出すときは、こちらが選ぶだけで答えられる形（「AかBか」）にして、なぜそれを決める必要があるかを添えてください。',
  '質問に対する回答が与えられている場合は、それを前提として扱い、同じことを再び質問しないでください。',
  '',
  '■ そのほか守ること',
  '- 指示に関係のない行は挙げない。誤字の修正や言い回しの改善を勝手に混ぜない。',
  '- 書式（条番号・項番号・箇条書きの記号・行の分かれ方・表の体裁）は、指示で変えるよう言われていない限りそのまま保つ。',
  '- 文体（です・ます調か、である調か）は元の行に合わせる。',
  '- 金額・期日・当事者名など、指示にも前提にも書かれていない具体的な値を勝手に作らない。',
  '',
  '出力は次の形のJSONだけ。説明文は付けない。',
  '{',
  '  "questions": ["指示だけでは決まらず、人に決めてもらう必要があること"],',
  '  "edits": [{ "startLine": 数値, "endLine": 数値, "replace": "書き換えた後のその範囲の文章（複数行なら改行を含める）", "reason": "なぜここを直すのかを日本語一文で" }],',
  '  "warnings": ["人が判断すべきこと・直せなかったこと・確認したほうがよい箇所"]',
  '}',
  'startLine/endLineは1始まりで、endLineの行を含みます。1行だけ直すときはstartLineとendLineを同じにしてください。',
  '質問がある場合でも、前提から確実に言えるところは edits に出してかまいません。ただし質問の答え次第で変わる箇所は edits に出さず、questions だけにしてください。',
  '直すところが無ければ edits は空配列にし、なぜ無いかを warnings に書いてください。',
].join('\n');

const CHECK_SYSTEM_PROMPT = [
  'あなたは日本語の契約書を読む校閲担当者です。行番号付きの契約書の全文と、この契約の前提が与えられます。',
  'この契約書の中で、次のものを探して報告してください。書き換えはしません。',
  '- 互いに矛盾している記述（同じ事柄について別の場所で違うことが書かれている）',
  '- 前提（実施期間・料金・回数など）と食い違っている記述',
  '- 請求の回数・期間が実態と合っていない記述（一括の料金なのに毎月請求になっている、実施していない月にも請求が立つ、実施期間と請求対象期間がずれている など）',
  '- 直し忘れて古いまま取り残されている記述',
  '- 空欄・仮の値・{{項目名}}のような差し込み漏れ',
  '- 参照している条番号や別表の番号が実際の条文と合っていない箇所',
  '',
  '出力は次の形のJSONだけ。説明文は付けない。',
  '{ "issues": [{ "lines": [行番号の配列], "detail": "何がどう食い違っているかを日本語で", "severity": "high" または "low" }] }',
  'severityは、そのまま締結すると解釈が割れる・金銭の出入りが変わる・不利になるものをhigh、体裁や表記ゆれの類をlowにしてください。',
  '見つからなければ issues は空配列にしてください。無理に挙げないこと。',
].join('\n');

// 指示に沿って直すべき箇所を、契約書全体から挙げてもらう。書き込みは一切しない。
async function proposeContractEdits({ apiKey, text, instruction, focus, facts, answers }) {
  const lines = splitLines(text);
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: REVISION_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EDIT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          'この契約の前提（システムに登録されている事実です。ここに書かれていないことは「分からないこと」として扱ってください）:',
          '---',
          formatFacts(facts),
          '---',
          '',
          '契約書の全文（各行の先頭は行番号です。行番号は契約書の一部ではありません）:',
          '---',
          numberLines(lines),
          '---',
          '',
          `指示: ${instruction}`,
          // 選択は「ここが気になっている」というヒントとしてだけ使う。
          // ここに引きずられて他の箇所を見落とすのが最初の不具合の原因なので、
          // 「ここだけ直せばよいという意味ではない」と明示する。
          ...(focus ? [
            '',
            '利用者が画面で選んでいた部分（気になっている箇所の手がかりです。ここだけ直せばよいという意味ではありません。必ず全文を見てください）:',
            '---',
            focus,
            '---',
          ] : []),
          // 前回の質問に人が答えている場合。これも「前提」として扱わせる。
          ...(answers ? [
            '',
            '前回の質問に対する回答（これも前提として扱い、同じことを再び質問しないでください）:',
            '---',
            answers,
            '---',
          ] : []),
        ].join('\n'),
      },
    ],
    max_tokens: 4000,
    temperature: 0.1,
  });

  const parsed = parseJsonReply(completion.choices[0]?.message?.content || '');
  const { edits, warnings } = normalizeEdits(parsed.edits, lines);
  const aiWarnings = (Array.isArray(parsed.warnings) ? parsed.warnings : [])
    .map((w) => String(w).trim())
    .filter(Boolean);
  const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map((q) => String(q).trim())
    .filter(Boolean);
  return { questions, edits, warnings: [...aiWarnings, ...warnings] };
}

// 今の本文を通しで読み、矛盾・直し忘れが残っていないかだけを報告する。
async function checkContractConsistency({ apiKey, text, facts }) {
  const lines = splitLines(text);
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: REVISION_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: CHECK_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          'この契約の前提:',
          '---',
          formatFacts(facts),
          '---',
          '',
          '契約書の全文（各行の先頭は行番号です）:',
          '---',
          numberLines(lines),
          '---',
        ].join('\n'),
      },
    ],
    max_tokens: 2000,
    temperature: 0.1,
  });

  const parsed = parseJsonReply(completion.choices[0]?.message?.content || '');
  const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
    .map((issue) => ({
      lines: (Array.isArray(issue?.lines) ? issue.lines : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= lines.length),
      detail: issue?.detail != null ? String(issue.detail).trim() : '',
      severity: issue?.severity === 'high' ? 'high' : 'low',
    }))
    .filter((issue) => issue.detail);
  return { issues };
}

module.exports = {
  REVISION_MODEL,
  splitLines,
  numberLines,
  formatFacts,
  lineRangeToFlatRange,
  normalizeEdits,
  proposeContractEdits,
  checkContractConsistency,
};
