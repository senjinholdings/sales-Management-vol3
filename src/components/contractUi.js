import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

// account-sales-board(src/components/ui.js)の部品をそのまま移したもの。契約書まわりの画面
// （account-sales-boardから移した画面）だけが使う。重なり順(z-index)だけは、こちらの案件詳細パネル
// (1000〜1001)より上に出るよう引き上げてある（案件詳細から開いた契約書の画面が裏に隠れないように）。

export const PageWrap = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 12px 48px;
  @media (max-width: 640px) {
    padding: 12px 12px 56px;
  }
`;

export const PageTitle = styled.h1`
  font-size: 19px;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 16px;
  @media (max-width: 640px) {
    font-size: 17px;
    margin-bottom: 12px;
  }
`;

export const Section = styled.section`
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
  @media (max-width: 640px) {
    padding: 12px;
    border-radius: 10px;
  }
`;

export const SectionTitle = styled.h2`
  font-size: 15px;
  font-weight: 700;
  color: #374151;
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const EmptyNote = styled.p`
  color: #9ca3af;
  font-size: 13px;
  margin: 0;
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid #f3f4f6;
  &:last-child {
    border-bottom: none;
  }
  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
`;

export const RowMain = styled.div`
  flex: 1;
  min-width: 0;
`;

export const CompanyName = styled.div`
  font-weight: 600;
  color: #1f2937;
  font-size: 14px;
`;

export const MetaLine = styled.div`
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
`;

export const ActionGroup = styled.div`
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
`;

export const Button = styled.button`
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  white-space: nowrap;
  background: ${(p) => (p.$variant === 'primary' ? '#1f2937' : p.$variant === 'danger' ? '#dc2626' : '#ffffff')};
  color: ${(p) => (p.$variant === 'primary' || p.$variant === 'danger' ? '#ffffff' : '#374151')};
  border-color: ${(p) => (p.$variant ? 'transparent' : '#d1d5db')};
  &:hover {
    opacity: 0.9;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (max-width: 640px) {
    padding: 8px 12px;
    font-size: 13px;
  }
`;

export const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  background: ${(p) => p.$bg || '#f3f4f6'};
  color: ${(p) => p.$color || '#374151'};
`;

export const Table = styled.table`
  width: 100%;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 12px;
`;

export const Th = styled.th`
  text-align: left;
  color: #6b7280;
  font-weight: 600;
  padding: 6px;
  border-bottom: 2px solid #e5e7eb;
  white-space: nowrap;
`;

export const Td = styled.td`
  padding: 6px;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: middle;
`;

export const TableLink = styled.a`
  color: #1f2937;
  font-weight: 600;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

export const Label = styled.label`
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 4px;
`;

export const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  &:focus {
    outline: none;
    border-color: #374151;
  }
  /* iOSのSafariはinputのfont-sizeが16px未満だとフォーカス時に自動ズームするため */
  @media (max-width: 640px) {
    font-size: 16px;
  }
`;

// 金額・件数などの整数入力欄。表示は3桁区切りのカンマ付きにするが、
// value/onChangeでやり取りする実際の値はカンマ無しの数字文字列のまま
// （既存のset(key)ヘルパー・Number()変換をそのまま使えるようにするため）。
// カーソル位置は、直前までの数字の個数を基準に再計算して維持する。
export function NumberInput({ value, onChange, ...props }) {
  const ref = useRef(null);
  const format = (v) => (v === '' || v === null || v === undefined ? '' : Number(v).toLocaleString('en-US'));

  const handleChange = (e) => {
    const input = e.target;
    const cursorPos = input.selectionStart ?? input.value.length;
    const digitsBeforeCursor = input.value.slice(0, cursorPos).replace(/[^\d]/g, '').length;
    const rawDigits = input.value.replace(/[^\d]/g, '');
    onChange({ target: { value: rawDigits } });
    requestAnimationFrame(() => {
      if (!ref.current) return;
      const formatted = format(rawDigits);
      let count = 0;
      let pos = 0;
      for (; pos < formatted.length && count < digitsBeforeCursor; pos += 1) {
        if (/\d/.test(formatted[pos])) count += 1;
      }
      ref.current.setSelectionRange(pos, pos);
    });
  };

  return <Input ref={ref} type="text" inputMode="numeric" value={format(value)} onChange={handleChange} {...props} />;
}

// "1430"→"14:30"、"930"→"09:30"、"9"→"09:00"、"14:3"→"14:03"のように、
// 数字だけの打鍵を"HH:mm"として解釈する（全角数字・全角コロンも半角に直してから見る）。
// 時が24以上・分が60以上など解釈できないものはnullを返し、呼び出し元で直前の値に戻す
// （入力を黙って壊さないため）。
function normalizeTimeText(raw) {
  if (raw === null || raw === undefined) return null;
  const halfWidth = String(raw)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .trim();
  if (halfWidth === '') return null;
  let hh;
  let mm;
  if (halfWidth.includes(':')) {
    const [h, m = ''] = halfWidth.split(':');
    if (!/^\d{1,2}$/.test(h) || !/^\d{0,2}$/.test(m)) return null;
    hh = h;
    mm = m === '' ? '00' : m.padStart(2, '0');
  } else {
    if (!/^\d{1,4}$/.test(halfWidth)) return null;
    if (halfWidth.length <= 2) {
      hh = halfWidth;
      mm = '00';
    } else {
      mm = halfWidth.slice(-2);
      hh = halfWidth.slice(0, -2);
    }
  }
  const h = Number(hh);
  const m = Number(mm);
  if (Number.isNaN(h) || Number.isNaN(m) || h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// <input type="time">の代わりに使う、見た目・打鍵感は普通のテキスト入力の時刻欄。
// ブラウザ標準のtime入力は数字が打ちにくいという指摘への対応。value/onChangeは
// これまでと同じ"HH:mm"文字列だけを扱う(呼び出し側のロジック変更は不要)。
// 入力中は自由に打たせ、フォーカスを外した時だけ正規化するので、"1430"のような
// 途中の打鍵をいちいち弾かない。
export function TimeInput({ value, onChange, placeholder = '14:00', ...props }) {
  const [text, setText] = useState(value || '');
  // 打ち始めた時点の値。入力が最後まで時刻として成立しなかった場合はここへ戻す。
  const entryValueRef = useRef(value || '');
  const focusedRef = useRef(false);

  // フォームのリセットなど、外部からvalueが変わった時は表示にも反映する。
  // ただし入力中(フォーカス中)は書き換えない。ここを無条件にしていたせいで、
  // 「1」を打った瞬間に01:00として親に伝わり、それが戻ってきて入力欄の文字が
  // 「01:00」に置き換わってしまい、続けて打った「2」が意図しない位置に入る、という
  // 非常に打ちにくい状態になっていた。
  useEffect(() => {
    if (focusedRef.current) return;
    setText(value || '');
    entryValueRef.current = value || '';
  }, [value]);

  const handleBlur = () => {
    focusedRef.current = false;
    const normalized = normalizeTimeText(text);
    if (normalized === null) {
      // 時刻として成立しないまま離れた場合は、打ち始めた時点の値に戻す。
      // 入力途中の確定(下のonChange)で中途半端な値が親に渡っていることがあるため、
      // 表示だけでなく親の値も戻す。例えば「2500」と打つと、途中の「250」が
      // 02:50として一度確定してしまう。ここで戻さないと、打ち間違いが
      // それらしい別の時刻として黙って残ってしまう。
      setText(entryValueRef.current);
      if (entryValueRef.current !== value) {
        onChange({ target: { value: entryValueRef.current } });
      }
      return;
    }
    setText(normalized);
    entryValueRef.current = normalized;
    if (normalized !== value) onChange({ target: { value: normalized } });
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        focusedRef.current = true;
        entryValueRef.current = value || '';
        if (props.onFocus) props.onFocus(e);
      }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        // 打ち終わってすぐ保存ボタンを押した時に値が拾われないこと
        // (blurとclickの発火順に依存すること)を避けるため、入力途中でも確定はさせる。
        // ただし1〜2桁だけの時点では確定させない。「12:00」と打ちたいのに「1」の時点で
        // 01:00として確定してしまい、打ち間違いのような値が残るため。
        // 1〜2桁を時刻として扱う解釈(9→09:00)は、打ち終わったblurの時だけに任せる。
        if (/^\d{1,2}$/.test(next.trim())) return;
        const normalized = normalizeTimeText(next);
        if (normalized !== null && normalized !== value) {
          onChange({ target: { value: normalized } });
        }
      }}
      onBlur={handleBlur}
      {...props}
    />
  );
}

export const Select = styled.select`
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  background: #ffffff;
  @media (max-width: 640px) {
    font-size: 16px;
  }
`;

export const TextArea = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  min-height: 64px;
  resize: vertical;
  &:focus {
    outline: none;
    border-color: #374151;
  }
  @media (max-width: 640px) {
    font-size: 16px;
  }
`;

export const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

export const FormField = styled.div`
  margin-bottom: 4px;
`;

// 外側をクリックして閉じる、の扱い。
//
// 入力中に閉じてしまって書いたものが消える、という事故が起きていた。原因は2つある。
//   1. 本文の文字をドラッグで選んで、枠の外で指を離す。押した場所は入力欄の中なのに、
//      clickイベントは共通の親（オーバーレイ）で起きるので「外側クリック」と見なされる。
//   2. トラックパッドでかすっただけの1クリックでも、書きかけごと消えてしまう。
//
// 1は「押した場所も離した場所もオーバーレイ自身のときだけ閉じる」で防ぐ。
// 2は、書きかけがあるときに確認を挟んで防ぐ。閉じるボタンは今まで通り一発で閉じる
// （こちらは人が意図して押しているので、確認は出さない）。
//
// 「書きかけがあるか」は、中のtextareaに文字が入っているかで見る。書いて困るのは
// 自由文（メール本文・アピール文・実施内容・契約書の本文・依頼文）で、それは全部textarea。
// 画面ごとに判定を書き分けると、新しい画面に付け忘れて同じ事故がまた起きる。
// 判定が足りない画面は dirty で足せる（添付だけ付けて本文が空、のような場合）。
//
// 使い方: <ModalOverlay {...overlayDismiss(onClose)}>
// 押し始めた要素。毎回の描画で作り直される戻り値に持たせると、mousedownとclickの間に
// 再描画が入ったときに失われるので、モジュール側に置く（同時に触れるオーバーレイは1つ）。
let overlayMouseDownTarget = null;

export function overlayDismiss(onClose, { dirty = false } = {}) {
  return {
    onMouseDown: (e) => { overlayMouseDownTarget = e.target; },
    onClick: (e) => {
      const startedOnOverlay = overlayMouseDownTarget === e.currentTarget;
      overlayMouseDownTarget = null;
      // 中で始まったドラッグ、中の要素へのクリックでは閉じない。
      if (!startedOnOverlay || e.target !== e.currentTarget) return;
      const typing = dirty || Array.from(e.currentTarget.querySelectorAll('textarea'))
        .some((t) => String(t.value || '').trim() !== '');
      // eslint-disable-next-line no-alert
      if (typing && !window.confirm('入力した内容が消えます。閉じてよいですか？')) return;
      onClose();
    },
  };
}

export const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
  @media (max-width: 640px) {
    align-items: flex-end;
    padding: 0;
  }
`;

export const ModalCard = styled.div`
  background: #ffffff;
  border-radius: 12px;
  padding: 24px;
  width: 100%;
  max-width: 420px;
  max-height: 90vh;
  overflow-y: auto;
  @media (max-width: 640px) {
    max-width: 100%;
    border-radius: 16px 16px 0 0;
    padding: 16px;
    max-height: 88vh;
  }
`;

// メール作成など、下にどんどん伸びる長いフォームを画面下部に押し込まず、
// 横から出てくる小さいウィンドウのように見せるためのパネル。
export const SidePanelOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
  z-index: 2100;
`;

export const SidePanel = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  height: 100dvh;
  /* 既定は480px。契約書の本文のように横幅が要るものは $width で広げる。 */
  width: ${(p) => p.$width || 'min(480px, 100vw)'};
  background: #ffffff;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.2);
  padding: 20px;
  overflow-y: auto;
  z-index: 2101;
  @media (max-width: 640px) {
    padding: 16px;
  }
`;

export const ModalTitle = styled.h3`
  font-size: 16px;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 16px;
`;

export const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
`;

export const ChoiceRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
`;

export const TabBar = styled.div`
  display: flex;
  gap: 4px;
  border-bottom: 2px solid #e5e7eb;
  margin-bottom: 16px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

export const TabButton = styled.button`
  padding: 8px 14px;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -2px;
  color: ${(p) => (p.$active ? '#1f2937' : '#6b7280')};
  border-bottom: 2px solid ${(p) => (p.$active ? '#1f2937' : 'transparent')};
  &:hover {
    color: #1f2937;
  }
`;

export const ChoiceButton = styled.button`
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid ${(p) => (p.$active ? '#1f2937' : '#d1d5db')};
  background: ${(p) => (p.$active ? '#1f2937' : '#ffffff')};
  color: ${(p) => (p.$active ? '#ffffff' : '#374151')};
`;

export const FieldError = styled.div`
  color: #dc2626;
  font-size: 12px;
  margin-top: 4px;
`;

// 3カラムの情報グリッド。タブレットで2列、スマホで1列に落とす。
export const InfoGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(${(p) => p.$cols || 3}, 1fr);
  gap: 12px;
  @media (max-width: 900px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

// カード類を並べるグリッド。幅に応じて自動で列数が決まる。
export const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(${(p) => p.$min || 220}px, 1fr));
  gap: 12px;
`;

// 横幅の広い表をスマホで横スクロールさせるためのラッパー。
export const TableScroll = styled.div`
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
`;

// ページ見出しと操作ボタンの行。狭い画面では折り返す。
export const PageHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
`;
