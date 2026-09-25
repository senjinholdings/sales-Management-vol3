// 契約書の本文を行単位で突き合わせるための道具。用途は2つある。
//
// 1. 全体差分の表示（ContractDocumentRevision.js）
//    直した1箇所だけ見せても、その条項が他の条項と矛盾していないかは分からないので、
//    生成直後の本文と今の本文を全文並べて見せる。
// 2. 画面で直接書き換えた本文を、Googleドキュメントに反映するための「変更箇所」の抽出
//    （ContractDocumentRevision.js。account-sales-boardでは雛形の編集画面でも使っている）
//    Googleドキュメントは「この範囲をこの文字にする」という単位でしか書き換えられないため、
//    編集後の全文から「どこがどう変わったか」を割り出して、その範囲だけを送る。
//
// 行単位にしているのは、契約書の変更が「この条項を丸ごと書き直す」という形になるのが
// 普通で、文字単位まで刻むとかえって読みにくくなるため。差分ライブラリは入れていない
// （依存を増やすほどの処理ではなく、LCSを素直に書けば足りる）。

// 改行を行末に含めたまま分割する。位置（何文字目か）をそのまま足し算で出せるようにするため、
// 行を連結すると必ず元の文字列に戻る形にしておく。
export function splitLines(text) {
  return String(text == null ? '' : text).match(/[^\n]*\n|[^\n]+/g) || [];
}

// 最長共通部分列。行数が多い契約書でも、先頭と末尾の一致部分を先に削ってから
// 表を作るので、実際に総当たりする範囲は「本当に変わったあたり」だけで済む。
function lcsTable(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

// 行の対応を { type, leftIndex, rightIndex } の列にする。
// type は 'equal' / 'remove'（左だけにある） / 'add'（右だけにある）。
function diffOps(leftLines, rightLines) {
  const ops = [];
  let head = 0;
  while (head < leftLines.length && head < rightLines.length && leftLines[head] === rightLines[head]) {
    ops.push({ type: 'equal', leftIndex: head, rightIndex: head });
    head += 1;
  }
  let tail = 0;
  while (
    tail < leftLines.length - head
    && tail < rightLines.length - head
    && leftLines[leftLines.length - 1 - tail] === rightLines[rightLines.length - 1 - tail]
  ) {
    tail += 1;
  }
  const a = leftLines.slice(head, leftLines.length - tail);
  const b = rightLines.slice(head, rightLines.length - tail);

  const table = lcsTable(a, b);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', leftIndex: head + i, rightIndex: head + j });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'remove', leftIndex: head + i, rightIndex: null });
      i += 1;
    } else {
      ops.push({ type: 'add', leftIndex: null, rightIndex: head + j });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) ops.push({ type: 'remove', leftIndex: head + i, rightIndex: null });
  for (; j < b.length; j += 1) ops.push({ type: 'add', leftIndex: null, rightIndex: head + j });

  for (let k = 0; k < tail; k += 1) {
    ops.push({
      type: 'equal',
      leftIndex: leftLines.length - tail + k,
      rightIndex: rightLines.length - tail + k,
    });
  }
  return ops;
}

// 並べて表示するための行の配列。消えた行と足された行が続いているときは
// 1行ずつ左右に組にする（「この行がこう変わった」という形で読めるようにするため）。
export function diffRows(leftText, rightText) {
  const leftLines = splitLines(leftText);
  const rightLines = splitLines(rightText);
  const ops = diffOps(leftLines, rightLines);
  const rows = [];
  const lineOf = (lines, index) => (index == null ? null : lines[index].replace(/\n$/, ''));

  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.type === 'equal') {
      rows.push({
        type: 'equal',
        left: lineOf(leftLines, op.leftIndex),
        right: lineOf(rightLines, op.rightIndex),
        leftNumber: op.leftIndex + 1,
        rightNumber: op.rightIndex + 1,
      });
      index += 1;
      continue;
    }
    const removed = [];
    while (index < ops.length && ops[index].type === 'remove') { removed.push(ops[index]); index += 1; }
    const added = [];
    while (index < ops.length && ops[index].type === 'add') { added.push(ops[index]); index += 1; }
    const pairs = Math.max(removed.length, added.length);
    for (let k = 0; k < pairs; k += 1) {
      const r = removed[k];
      const a = added[k];
      rows.push({
        type: r && a ? 'changed' : (r ? 'removed' : 'added'),
        left: r ? lineOf(leftLines, r.leftIndex) : null,
        right: a ? lineOf(rightLines, a.rightIndex) : null,
        leftNumber: r ? r.leftIndex + 1 : null,
        rightNumber: a ? a.rightIndex + 1 : null,
      });
    }
  }
  return rows;
}

export function hasDifference(leftText, rightText) {
  return String(leftText || '') !== String(rightText || '');
}

// 「変更されたかたまり」を、元のテキスト上の文字位置で返す。
// 返す順番は後ろから前（flatStartの降順）。Googleドキュメントは1箇所直すたびに
// それ以降の文字位置がズレるため、後ろから順に当てれば、まだ当てていない
// かたまりの位置は最初に計算したままで正しい。
export function changedRanges(leftText, rightText) {
  const leftLines = splitLines(leftText);
  const rightLines = splitLines(rightText);
  const ops = diffOps(leftLines, rightLines);

  const leftOffsets = [0];
  leftLines.forEach((line, k) => { leftOffsets[k + 1] = leftOffsets[k] + line.length; });

  const ranges = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === 'equal') { index += 1; continue; }
    const start = index;
    const removed = [];
    const added = [];
    while (index < ops.length && ops[index].type !== 'equal') {
      if (ops[index].type === 'remove') removed.push(ops[index].leftIndex);
      else added.push(ops[index].rightIndex);
      index += 1;
    }
    // 追加だけのかたまりは、元のテキスト上では「1点」になる。その位置は
    // 直前の equal な行の終わり（＝かたまりの直後にある左の行の始まり）。
    const flatStart = removed.length > 0
      ? leftOffsets[removed[0]]
      : leftOffsets[(() => {
        for (let k = start; k < ops.length; k += 1) {
          if (ops[k].leftIndex != null) return ops[k].leftIndex;
        }
        return leftLines.length;
      })()];
    const flatEnd = removed.length > 0 ? leftOffsets[removed[removed.length - 1] + 1] : flatStart;
    const addedText = added.map((k) => rightLines[k]).join('');

    // 本文の末尾に行を足す場合だけ別扱いにする。Googleドキュメントは最後の段落区切り
    // （本文の末尾の改行）より後ろには何も置けず、その改行を消すこともできないため、
    // 「最後の改行の手前に、改行＋足したい文字を入れる」形に読み替える。
    if (removed.length === 0 && flatStart >= leftText.length && leftText.endsWith('\n')) {
      const at = leftText.length - 1;
      ranges.push({
        flatStart: at,
        flatEnd: at,
        text: `\n${addedText.replace(/\n$/, '')}`,
        original: '',
      });
      continue;
    }

    // 本文の末尾の行を消す／書き換える場合も同じ制約に掛かる（最後の改行は消せない）。
    // 「消したい行の手前の改行から、最後の改行の1つ手前まで」に読み替えると、
    // 段落の数は正しく減り、最後の改行だけが残る。
    if (flatEnd >= leftText.length && leftText.endsWith('\n') && flatStart > 0) {
      const shiftedText = addedText ? `\n${addedText.replace(/\n$/, '')}` : '';
      ranges.push({
        flatStart: flatStart - 1,
        flatEnd: flatEnd - 1,
        text: shiftedText,
        original: leftText.slice(flatStart - 1, flatEnd - 1),
      });
      continue;
    }

    // 本文を先頭から末尾まで丸ごと書き換える場合。手前にずらす余地が無いので、
    // 最後の改行だけは残す（Googleドキュメントは必ず改行で終わる）。
    const end = flatEnd >= leftText.length && leftText.endsWith('\n') ? leftText.length - 1 : flatEnd;
    ranges.push({
      flatStart,
      flatEnd: end,
      text: end === flatEnd ? addedText : addedText.replace(/\n$/, ''),
      original: leftText.slice(flatStart, end),
    });
  }
  return ranges.sort((x, y) => y.flatStart - x.flatStart);
}
