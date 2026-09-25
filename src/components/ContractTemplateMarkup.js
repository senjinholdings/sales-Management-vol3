import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, MetaLine, TextArea, FieldError, EmptyNote, Label, SidePanelOverlay, SidePanel, Input, overlayDismiss,
} from './contractUi.js';
import { api } from '../services/contractApi.js';
import { applyDocumentEdits } from '../utils/applyDocumentEdits.js';

// 契約書雛形（Googleドキュメント）の本文を表示し、選択した部分を{{項目名}}に置き換える画面。
//
// 画面の下に押し込めると本文を読む面積が足りないので、チャットのスレッド返信と同じように
// 右から出るパネルにして、本文が縦いっぱいに見えるようにしてある。
//
// 本文は「そのまま書き換えられるtextarea」に出す。文章を直したいときに、直す場所と直す文字を
// 別の欄で指定させるのは回りくどいので、Googleドキュメントと同じように本文の中で
// 打ち込んで消せるようにしてある。保存を押した時点で、元の本文と見比べて変わった
// かたまりだけをGoogleドキュメントに当てる（applyDocumentEdits.js）。
//
// textareaにしているのは表示の都合だけでなく、位置合わせのため。divに出してDOMのRangeから
// 文字位置を数えると、改行や空白の扱いでサーバー側のフラットテキストと位置がズレやすいが、
// textareaならselectionStart/selectionEndがそのまま「文字列の何文字目か」になり、
// サーバーがdocuments.getから組み立てたテキストと必ず一致する。
export default function ContractTemplateMarkup({ contract, presets, onPresetAdded, onRequestFieldsUpdated, onConverted, onClose }) {
  const [template, setTemplate] = useState(null);
  // 画面の中で編集している本文。保存するまでGoogleドキュメントには書き込まない。
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selection, setSelection] = useState(null);
  const [applyingLabel, setApplyingLabel] = useState('');
  const [saving, setSaving] = useState(false);
  // 項目名をその場で増やせるようにする。マークを付けている最中に「この項目名が要る」と
  // 気づくことがあり、いちど閉じて入力項目マスタへ行って戻る、では手が止まるため。
  const [newPresetLabel, setNewPresetLabel] = useState('');
  const [addingPreset, setAddingPreset] = useState(false);
  // DriveにWordファイル(.docx)として置かれている雛形は、Googleドキュメントの画面で
  // 開けてもDocs APIでは読めない。その場合はここから変換した複製を作れるようにする
  // （変換する手段がどこにも無いと、開けないまま手詰まりになる）。
  const [converting, setConverting] = useState(false);
  // 開けなかった理由がWordファイルであること。サーバーが返す印で判定する。
  const [isOfficeFile, setIsOfficeFile] = useState(false);

  const load = useCallback(() => {
    setError('');
    setTemplate(null);
    setIsOfficeFile(false);
    api.getContractTemplate(contract.id)
      .then((data) => { setTemplate(data); setDraft(data.text); setSelection(null); })
      .catch((err) => { setError(err.message); setIsOfficeFile(err.code === 'office_file'); });
  }, [contract.id]);

  // Wordファイルのままの雛形を、Googleドキュメントに変換した複製にする。
  // 変換後はその新しい版を開き直す（元のファイルは変わらない）。
  const handleConvert = async () => {
    setConverting(true);
    setError('');
    try {
      const created = await api.createContractMarkupCopy(contract.id);
      if (onConverted) onConverted(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setConverting(false);
    }
  };


  useEffect(() => { load(); }, [load]);

  const dirty = !!template && draft !== template.text;

  const handleSelect = (e) => {
    const { selectionStart, selectionEnd } = e.target;
    setSelection({ start: selectionStart, end: selectionEnd });
  };

  // 編集した本文をGoogleドキュメントに反映する。反映後のテキストが手元の編集内容と
  // 一致していることまで確かめる（一致していないと、この後のマーク付けで使う文字位置が
  // ズレるため）。戻り値は「この先マーク付けを続けてよいか」。
  const saveDraft = useCallback(async () => {
    const { latest } = await applyDocumentEdits({
      baseText: template.text,
      draftText: draft,
      edit: (data) => api.editContractTemplateText(contract.id, data),
    });
    if (!latest) return true;
    setTemplate(latest);
    setDraft(latest.text);
    if (latest.requestFields && onRequestFieldsUpdated) onRequestFieldsUpdated(latest.requestFields);
    if (latest.text !== draft) {
      setSelection(null);
      setNotice('保存しましたが、Googleドキュメント側の整形により本文が少し変わりました。選び直してください');
      return false;
    }
    return true;
  }, [contract.id, draft, template, onRequestFieldsUpdated]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await saveDraft();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // 選択範囲を{{項目名}}に置き換える。本文を直しかけのままでも押せるように、
  // 先に編集内容を保存してから当てる（保存後の本文＝手元の本文なので、選択位置はそのまま使える）。
  const handleApply = async (label) => {
    if (!selection || selection.end <= selection.start) return;
    setApplyingLabel(label);
    setError('');
    setNotice('');
    try {
      if (dirty && !(await saveDraft())) return;
      const data = await api.addContractTemplateMarker(contract.id, {
        flatStart: selection.start,
        flatEnd: selection.end,
        label,
      });
      setTemplate(data);
      setDraft(data.text);
      setSelection(null);
      if (data.requestFields && onRequestFieldsUpdated) onRequestFieldsUpdated(data.requestFields);
    } catch (err) {
      setError(err.message);
    } finally {
      setApplyingLabel('');
    }
  };

  // 項目名を登録してから、そのまま選択範囲に当てる。2手を1手にするため
  // (項目名を作りたいのは、いま選んでいる箇所に当てたいときだから)。
  const handleAddPreset = async () => {
    const label = newPresetLabel.trim();
    if (!label) return;
    setAddingPreset(true);
    setError('');
    try {
      await api.createContractFieldPreset(label);
      setNewPresetLabel('');
      if (onPresetAdded) await onPresetAdded();
      if (selection && selection.end > selection.start) await handleApply(label);
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingPreset(false);
    }
  };

  const hasRange = !!selection && selection.end > selection.start;
  const selectedText = hasRange ? draft.slice(selection.start, selection.end) : '';
  const markers = useMemo(() => (template ? template.markers : []), [template]);
  const busy = saving || !!applyingLabel;

  return (
    <SidePanelOverlay {...overlayDismiss(onClose)}>
      <SidePanel $width="min(1000px, 100vw)" style={{ overflowY: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{contract.name}（項目入り版）</div>
            <Button onClick={onClose}>閉じる</Button>
          </div>

          {error && !template && (
            <div>
              <FieldError>{error}</FieldError>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {isOfficeFile && (
                  <Button type="button" $variant="primary" disabled={converting} onClick={handleConvert}>
                    {converting ? '変換中...' : 'Googleドキュメントに変換した版を作る'}
                  </Button>
                )}
                <Button type="button" onClick={load}>再読み込み</Button>
                <Button type="button" as="a" href={contract.url} target="_blank" rel="noopener noreferrer">
                  Googleドライブで開く
                </Button>
              </div>
              {isOfficeFile && (
                <MetaLine style={{ marginTop: 6 }}>
                  変換した版は新しいバージョンとして登録され、そちらにマークを付けます。元のファイルは変わりません。
                  複雑な表や図形は見た目が変わることがあるので、変換後に一度開いて確認してください。
                </MetaLine>
              )}
            </div>
          )}
          {!template && !error && <EmptyNote>雛形を読み込み中...</EmptyNote>}

          {template && (
            <>
              <MetaLine>
                本文はこの場で直接書き換えられます（打ち込む・消す）。「変更を保存」を押すと
                Googleドキュメントに反映されます。{'{{項目名}}'}にしたいところは、本文でドラッグして選んでから
                右の項目名を押してください。書き換え先はこの「項目入り版」だけで、元の雛形は変わりません。
                表はセルごとに改行して並べています（罫線はここには出ません）。
              </MetaLine>

              {/* 本文を縦いっぱいに広げる。契約書は長いので、読める面積がそのまま使いやすさになる。 */}
              <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, flexWrap: 'wrap', overflowY: 'auto' }}>
                <TextArea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onSelect={handleSelect}
                  disabled={busy}
                  style={{
                    flex: '2 1 380px', minWidth: 260, minHeight: 240, resize: 'none',
                    fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap',
                    background: dirty ? '#fffbeb' : undefined,
                  }}
                />
                <div style={{ flex: '1 1 220px', minWidth: 200, overflowY: 'auto' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button type="button" $variant="primary" disabled={!dirty || busy} onClick={handleSave}>
                      {saving ? '保存中...' : dirty ? '変更を保存' : '変更なし'}
                    </Button>
                    <Button type="button" disabled={!dirty || busy} onClick={() => { setDraft(template.text); setSelection(null); }}>
                      編集を取り消す
                    </Button>
                  </div>
                  {notice && <MetaLine style={{ marginTop: 4, color: '#92400e' }}>{notice}</MetaLine>}

                  <Label style={{ marginTop: 12 }}>選択中の文字</Label>
                  {hasRange
                    ? <div style={{ fontSize: 12, background: '#fef3c7', padding: 6, borderRadius: 4, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{selectedText}</div>
                    : <EmptyNote>{'{{項目名}}'}にしたい部分を本文でドラッグして選んでください</EmptyNote>}

                  <Label style={{ marginTop: 12 }}>項目名を選んで置き換え</Label>
                  {presets.length === 0 && <EmptyNote>項目名がまだありません。下の欄で追加できます</EmptyNote>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {presets.map((p) => (
                      <Button
                        key={p.id}
                        type="button"
                        disabled={!hasRange || busy}
                        onClick={() => handleApply(p.label)}
                      >
                        {applyingLabel === p.label ? '置き換え中...' : p.label}
                      </Button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <Input
                      value={newPresetLabel}
                      onChange={(e) => setNewPresetLabel(e.target.value)}
                      placeholder="新しい項目名"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <Button type="button" disabled={!newPresetLabel.trim() || addingPreset} onClick={handleAddPreset}>
                      {addingPreset ? '追加中...' : '＋追加'}
                    </Button>
                  </div>
                  <MetaLine style={{ marginTop: 4 }}>
                    追加した項目名は入力項目マスタに入り、他の契約書でも選べます。
                    本文を選んだ状態で追加すると、そのまま置き換わります。
                  </MetaLine>

                  <Label style={{ marginTop: 12 }}>この雛形に入っている項目</Label>
                  {markers.length === 0
                    ? <EmptyNote>まだありません</EmptyNote>
                    : <div style={{ fontSize: 12, wordBreak: 'break-all' }}>{markers.map((m) => `{{${m}}}`).join('　')}</div>}

                  {/* 操作ボタンはこの列に置く。パネルの一番下に置くと、本文が長いときに
                      はみ出して押せなくなる(実際に押せないという指摘を受けた)。 */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
                    <Button type="button" disabled={busy} onClick={load}>ドキュメントを読み直す</Button>
                    <Button type="button" as="a" href={contract.url} target="_blank" rel="noopener noreferrer">Googleドキュメントで開く</Button>
                  </div>
                </div>
              </div>

              {error && <FieldError>{error}</FieldError>}
            </>
          )}
        </div>
      </SidePanel>
    </SidePanelOverlay>
  );
}
