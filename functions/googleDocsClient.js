const { google } = require('googleapis');

// 契約書テンプレート(Googleドキュメント)を「プレーンテキストのプレビュー＋範囲選択で
// {{項目名}}を差し込む」ために使う薄いラッパー。documentGenerationRouter.js(Googleスライド)
// と同じ考え方(Drive APIでコピーし、対象APIのbatchUpdateでテキストを書き換える)だが、
// Docsはスライドと違って「1本の連続したテキスト」に見えるため、フラットな文字列と
// Doc上のインデックスを対応付ける必要がある。ここではその変換だけを担当し、
// 認証(どの担当者のGoogleアカウントを使うか)は呼び出し側(contractsRouter.js)に委ねる
// (calendarClient.js/documentGenerationRouter.jsと同じ、authを引数で受け取る形)。

// Googleドキュメント(スプレッドシートやPDFではない)のURLからドキュメントIDを取り出す。
// 契約書のURLはGoogleドキュメントとは限らない(PDF・Wordファイル等が登録されている
// ケースもある)ため、対応しないURLは例外にせずnullを返し、呼び出し側で分かりやすい
// 400エラーに変換してもらう(このモジュールが扱えるのはGoogleドキュメントだけ)。
function extractDocIdFromUrl(url) {
  const match = String(url || '').match(/docs\.google\.com\/document\/d\/([-\w]+)/);
  return match ? match[1] : null;
}

// documents.get のレスポンス(body.content)から、選択可能なプレーンテキストと、
// 「フラットテキストの何文字目がDoc上の何番目のインデックスか」のマップを組み立てる。
//
// 表(table.tableRows[].tableCells[].content[])の中も対象にする。契約書の雛形は料金や
// 実施期間を表で書いていることが多く、そこをマークできないと機能として使い物にならない
// (実際に「表の中は手で書いてください」と出て詰まった)。セルの中身も段落の集まりなので、
// 同じ処理を再帰で通す。Doc上のインデックスは表の中でも本文と同じ通し番号なので、
// 変換の仕組みはそのままで動く。
//
// segmentsはtextRun単位(段落単位ではない)で区切る。書式の変わり目などで1つの見た目上の
// テキストが複数のtextRun要素に分割されていることがあるため。
// GoogleドキュメントのインデックスはUTF-16コード単位で、JS文字列の.lengthも同じ単位
// なので、textRun.content.lengthをそのままflatとdocの両方の長さとして使えば、
// 変換時に文字数がズレることはない。
// Googleドキュメントは「段落内の改行」(Shift+Enterで入るソフト改行)を、textRunの中の
// 垂直タブ(U+000B)として返す。これをそのまま画面に出すと、見た目では改行されている
// 文章が1行に繋がって表示され、契約書がまったく読めなくなる
// (Wordから変換した雛形はソフト改行だらけになるので、とくに顕著)。
//
// 表示用に改行へ読み替えるが、**1文字を1文字に置き換える**ことが絶対条件。
// フラットテキストの文字位置がそのままDoc上のインデックスに対応しているので、
// 文字数が変わると選択範囲が別の場所を指すようになり、契約書を壊す。
// （表の区切りを見やすくするために記号を「足す」ようなことをしてはいけない、のも同じ理由）
const SOFT_LINE_BREAK = '\u000b';

function displayTextOf(runContent) {
  return runContent.split(SOFT_LINE_BREAK).join('\n');
}

function buildTemplateModelFromDocument(document) {
  const content = (document && document.body && document.body.content) || [];
  let text = '';
  const segments = [];
  const paragraphRanges = [];

  // 構造要素の配列を順に読む。表・目次は中に同じ形の配列を持っているので再帰で降りる。
  //
  // 段落には「どの入れ物の中にあるか」(container)も記録する。本文の連続した段落どうしは
  // Doc上のインデックスも連続しているので、まとめて置き換えても壊れない。一方、表のセルを
  // またぐとインデックスが飛ぶ(セルの境界に本文としては見えない構造がある)ため、
  // 同じ入れ物の中でだけ複数段落の選択を許す、という判定に使う。
  const walk = (structuralElements, container) => {
    for (const structuralElement of structuralElements || []) {
      if (structuralElement.paragraph) {
        const paragraphFlatStart = text.length;
        for (const el of structuralElement.paragraph.elements || []) {
          const runContent = el.textRun && typeof el.textRun.content === 'string' ? el.textRun.content : '';
          // 画像などtextRunを持たない段落内要素は、選択できる文字が無いだけなので無視する。
          if (!runContent) continue;
          segments.push({ flatStart: text.length, docStart: el.startIndex, length: runContent.length });
          text += displayTextOf(runContent);
        }
        paragraphRanges.push({ flatStart: paragraphFlatStart, flatEnd: text.length, container });
        continue;
      }
      if (structuralElement.table) {
        (structuralElement.table.tableRows || []).forEach((row, rowIndex) => {
          (row.tableCells || []).forEach((cell, cellIndex) => {
            walk(cell.content, `${container}/table${structuralElement.startIndex}:${rowIndex}:${cellIndex}`);
          });
        });
        continue;
      }
      if (structuralElement.tableOfContents) {
        walk(structuralElement.tableOfContents.content, `${container}/toc${structuralElement.startIndex}`);
        continue;
      }
      // sectionBreak等、テキストを持たない構造要素は選択できる範囲を増やすわけではないので無視する。
    }
  };
  walk(content, 'body');

  return { text, segments, paragraphRanges };
}

// フラットテキスト上の1文字分の位置(0 <= offset < text.length)を、対応するセグメントを
// 探してDoc上のインデックスに変換する。
function mapFlatOffsetToDocIndex(segments, offset) {
  const seg = segments.find((s) => offset >= s.flatStart && offset < s.flatStart + s.length);
  if (!seg) {
    throw new Error(`文字位置 ${offset} に対応するドキュメント上の位置が見つかりません`);
  }
  return seg.docStart + (offset - seg.flatStart);
}

function findParagraphContaining(paragraphRanges, offset) {
  return paragraphRanges.find((p) => offset >= p.flatStart && offset < p.flatEnd);
}

// フラットテキスト上の選択範囲[flatStart, flatEnd)を、Doc上の[docStart, docEnd)に変換する。
//
// 既定では1つの段落の中に収まる選択しか受け付けない({{項目名}}のマーク付けは段落の一部を
// 置き換える操作なので、それで足りる)。allowMultipleParagraphs を指定した場合だけ、
// 「同じ入れ物(本文なら本文、表なら同じセル)の中に収まっていること」を条件に段落を
// またぐ選択を許す。契約書の条項をまるごと直したいときは段落をまたぐのが普通なので、
// 文章の置き換え(AI修正を含む)ではこちらを使う。
// 入れ物をまたぐとDoc上のインデックスが連続しないため、その範囲をそのまま消すと
// 表の構造ごと壊れてしまう。そこだけは許さない。
function mapFlatRangeToDocRange(templateModel, flatStart, flatEnd, options) {
  const { segments, paragraphRanges, text } = templateModel;
  const allowMultipleParagraphs = !!(options && options.allowMultipleParagraphs);
  if (!Number.isInteger(flatStart) || !Number.isInteger(flatEnd)) {
    return { error: '選択範囲が不正です' };
  }
  if (flatEnd <= flatStart) {
    return { error: '文字を選択してからマーク付けしてください' };
  }
  if (flatStart < 0 || flatEnd > text.length) {
    return { error: '選択範囲がテキストの範囲外です' };
  }
  const startParagraph = findParagraphContaining(paragraphRanges, flatStart);
  if (!startParagraph) {
    return { error: '選択範囲の変換に失敗しました' };
  }
  if (flatEnd > startParagraph.flatEnd) {
    if (!allowMultipleParagraphs) {
      return { error: '選択範囲が複数の段落にまたがっています。1つの段落の中で選択し直してください' };
    }
    // 範囲に掛かる段落を全部見る。始点と終点だけ比べると、あいだに表が挟まっている
    // ケース(本文の段落→表→本文の段落)を見逃して、表ごと消してしまう。
    const covered = paragraphRanges.filter((pr) => pr.flatStart < flatEnd && pr.flatEnd > flatStart);
    if (covered.some((pr) => pr.container !== startParagraph.container)) {
      return { error: '表の中と外にまたがる選択は置き換えられません。表の中だけ／外だけで選び直してください' };
    }
    // 本文の最後の改行はGoogleドキュメントの仕様で消せない(消そうとするとAPIがエラーを返す)。
    // 選択の終端がそこに掛かっているときは、理由が分かる形で先に止める。
    if (flatEnd >= text.length) {
      return { error: '本文の最後の改行は選択に含められません。1文字手前まで選び直してください' };
    }
  }
  try {
    const docStart = mapFlatOffsetToDocIndex(segments, flatStart);
    // 終端は「選択した最後の1文字」の位置から+1して排他的な終端にする(セグメントを
    // またいでも、同じ段落内である限りDoc上のインデックスは連続しているため安全)。
    const docEnd = mapFlatOffsetToDocIndex(segments, flatEnd - 1) + 1;
    return { value: { docStart, docEnd } };
  } catch (error) {
    return { error: '選択範囲の変換に失敗しました' };
  }
}

// テキスト中の{{...}}をすべて検出し、出現順・重複除去して返す。
// documentGenerationRouter.js(Googleスライドのプレースホルダー検出)と同じ正規表現。
function detectMarkers(text) {
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const found = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const label = m[1].trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    found.push(label);
  }
  return found;
}

// ネイティブのGoogleドキュメントのMIMEタイプ。Drive上のWordファイル(.docx)は
// Googleドキュメントの画面で開けてしまうが、実体はOfficeファイルのままなので
// Docs APIでは読み書きできない(documents.getが
// "This operation is not supported for this document. The document must not be an Office file."
// を返す)。files.copyでこのMIMEタイプを指定すると、複製するときに変換できる。
const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';

// 上のエラーかどうか。理由が分かる案内(「項目入り版を作る」でGoogleドキュメントに
// 変換できる)に差し替えるために使う。権限やAPI無効化と混ぜてはいけないので、
// メッセージで判定する。
function isOfficeFileError(error) {
  const detail = (error && (
    (error.response && error.response.data && error.response.data.error && error.response.data.error.message)
    || (error.errors && error.errors[0] && error.errors[0].message)
    || error.message
  )) || '';
  return /must not be an Office file/i.test(String(detail));
}

function getDocsClient(auth) {
  return google.docs({ version: 'v1', auth });
}

async function fetchTemplateModel(auth, docId) {
  const docs = getDocsClient(auth);
  const { data } = await docs.documents.get({ documentId: docId });
  return buildTemplateModelFromDocument(data);
}

// テンプレートのプレビュー用データ({ text, markers })を返す。
async function getTemplateText(auth, docId) {
  const model = await fetchTemplateModel(auth, docId);
  return { text: model.text, markers: detectMarkers(model.text) };
}

// 選択範囲を任意の文字列に置き換える(空文字なら削除、flatStart === flatEnd なら挿入)。
// {{項目名}}のマーク付けも、文章の手直しも、やることは「この範囲をこの文字にする」で
// 同じなので1つにまとめてある。
//
// 呼び出しのたびにドキュメントを読み直してからインデックスを計算する
// (=1リクエストにつき1箇所だけ直す運用を前提とする)。複数箇所を1回のbatchUpdateで
// まとめて処理しようとすると、1つ目の置換でテキスト長が変わり2つ目以降の
// (呼び出し前に計算しておいた)インデックスがズレてしまうため、常に
// 「今のドキュメントの状態」から数え直す。
async function replaceRangeWithText(auth, docId, flatStart, flatEnd, text, options) {
  const replacement = String(text == null ? '' : text);
  const model = await fetchTemplateModel(auth, docId);
  const docs = getDocsClient(auth);

  // 挿入(範囲を選ばずカーソル位置に足す)。Googleドキュメントは本文末尾の改行より後ろには
  // 入れられないため、末尾ちょうどの位置は受け付けない。
  if (flatEnd === flatStart) {
    if (!replacement) {
      return { error: '追加する文字を入力してください' };
    }
    if (!Number.isInteger(flatStart) || flatStart < 0 || flatStart >= model.text.length) {
      return { error: '本文の中にカーソルを置いてから追加してください（末尾の改行より後ろには入れられません）' };
    }
    let docIndex;
    try {
      docIndex = mapFlatOffsetToDocIndex(model.segments, flatStart);
    } catch (error) {
      return { error: '挿入位置の変換に失敗しました' };
    }
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [{ insertText: { location: { index: docIndex }, text: replacement } }] },
    });
    return { value: true };
  }

  // 文章の置き換えは既定で段落をまたいでよい(条項をまるごと直す使い方が普通のため)。
  // {{項目名}}のマーク付けだけは1段落に限る(複数段落を1つの項目にする意味が無く、
  // 範囲を選び間違えたまま雛形を壊すのを防ぐため)。
  const allowMultipleParagraphs = !(options && options.allowMultipleParagraphs === false);
  const rangeResult = mapFlatRangeToDocRange(model, flatStart, flatEnd, { allowMultipleParagraphs });
  if (rangeResult.error) {
    return { error: rangeResult.error };
  }
  const { docStart, docEnd } = rangeResult.value;
  // 同じ入れ物の中であればDoc上のインデックスは連続しているので、選択範囲をそのまま
  // 消して入れ直せばよい(段落区切りも一緒に置き換わり、入力した改行で作り直される)。
  const requests = [{ deleteContentRange: { range: { startIndex: docStart, endIndex: docEnd } } }];
  if (replacement) {
    requests.push({ insertText: { location: { index: docStart }, text: replacement } });
  }
  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
  return { value: true };
}

// 選択範囲を{{項目名}}に置き換える。
async function replaceRangeWithMarker(auth, docId, flatStart, flatEnd, label) {
  const trimmedLabel = String(label || '').trim();
  if (!trimmedLabel) {
    return { error: '項目名を選択してください' };
  }
  return replaceRangeWithText(auth, docId, flatStart, flatEnd, `{{${trimmedLabel}}}`, { allowMultipleParagraphs: false });
}

module.exports = {
  getDocsClient,
  SOFT_LINE_BREAK,
  displayTextOf,
  GOOGLE_DOC_MIME_TYPE,
  isOfficeFileError,
  extractDocIdFromUrl,
  replaceRangeWithText,
  buildTemplateModelFromDocument,
  mapFlatRangeToDocRange,
  detectMarkers,
  getTemplateText,
  replaceRangeWithMarker,
};
