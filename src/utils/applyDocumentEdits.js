import { changedRanges } from './textDiff.js';

// 画面の中で直接書き換えた本文を、Googleドキュメントに反映する。
//
// Googleドキュメントは「この範囲をこの文字にする」という単位でしか書き換えられないので、
// 編集後の全文をそのまま送ることはできない。変わったかたまりだけを割り出して、
// 後ろのかたまりから順に当てていく（1箇所直すとそれ以降の文字位置がズレるため、
// 後ろから当てれば、まだ当てていないかたまりの位置は最初に計算したままで正しい）。
//
// expectedOriginal を一緒に送り、サーバー側で「そこが今も同じ文字か」を確かめてもらう。
// 画面を開いたまま誰かがGoogleドキュメント側を直していると、位置がズレて関係のない
// 場所を壊すことになるため、ズレていたら何もせずエラーにする。
//
// 雛形（ContractTemplateMarkup.js）と記入済み契約書（ContractDocumentRevision.js）で
// まったく同じ手順なので、呼ぶAPIだけを引数で受け取って1箇所にまとめてある。
export async function applyDocumentEdits({ baseText, draftText, edit }) {
  const ranges = changedRanges(baseText, draftText);
  let latest = null;
  for (const range of ranges) {
    // 1つずつ順番に当てる（まとめて送ると2つ目以降の位置がズレる）。
    // eslint-disable-next-line no-await-in-loop
    latest = await edit({
      flatStart: range.flatStart,
      flatEnd: range.flatEnd,
      text: range.text,
      expectedOriginal: range.original,
    });
  }
  return { latest, count: ranges.length };
}
