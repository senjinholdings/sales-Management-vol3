import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, MetaLine, TextArea, FieldError, EmptyNote, Label, SidePanelOverlay, SidePanel, Badge, overlayDismiss,
} from './contractUi.js';
import { api } from '../services/contractApi.js';
import { applyDocumentEdits } from '../utils/applyDocumentEdits.js';
import { diffRows } from '../utils/textDiff.js';

// 案件ごとに作った「記入済み契約書」を、その案件の事情に合わせて直す画面。
//
// 直すのはこの案件用に作った1ファイルだけ。雛形は全案件で共有するものなので、
// 「この案件は支払いを試作後にする」のような案件固有の文言を雛形に入れてしまうと、
// 次の案件に漏れる。雛形を直したいときはマスター管理 → 契約書管理の「項目入り版」で行う。
//
// AIへの指示は契約書全体に対して出す。最初は「選んだ範囲をこう直して」という作りに
// していたが、それでは「支払条件を前払いから月末払いに変える」という指示に対して
// 選んだ料金条項だけが直り、別の場所の支払条件が前払いのまま残った。同じ事柄が
// 複数の場所に書かれているのは契約書では普通なので、「関係する箇所を全部挙げさせて、
// 人が1件ずつ確認する」形にしてある。
//
// AIには契約書の本文だけでなく「この契約の前提」（案件情報と、契約書に差し込んだ項目の値）も
// 渡す。前提を渡さないと、書かれていないことを勝手に埋めてしまう
// （「9月末締め翌月末払いにして」という指示に対して、一括のパッケージ料金なのに
//  毎月請求の条項を書いてしまい、実施していない9月にも請求が立つ文面になりかけた）。
// それでも指示だけでは決まらないことは残るので、AIには「決まらないことは質問として出せ」と
// 頼み、人が答えてから作り直せるようにしてある。
//
// AIは提案までしかしない。提案は画面の下書きに入るだけで、Googleドキュメントには
// 「保存」を押すまで一切書き込まない。契約書は法務確認が前提の書類で、
// 気づかないうちに文言が変わっているのが一番まずいため。
// account-sales-boardでは案件・パートナーで呼ぶAPIを切り替えているため、その形を残してある
// （こちらは案件だけ）。
const KIND_CONFIG = {
  deal: {
    getText: api.getDealContractDocumentText,
    editText: api.editDealContractDocumentText,
    revise: api.reviseDealContractDocumentWithAi,
    check: api.checkDealContractDocumentConsistency,
  },
};

const ROW_STYLES = {
  equal: { left: 'transparent', right: 'transparent' },
  changed: { left: '#fee2e2', right: '#dcfce7' },
  removed: { left: '#fee2e2', right: '#f9fafb' },
  added: { left: '#f9fafb', right: '#dcfce7' },
};

function DiffView({ leftText, rightText, leftLabel, rightLabel }) {
  const rows = useMemo(() => diffRows(leftText || '', rightText || ''), [leftText, rightText]);
  const changedCount = rows.filter((r) => r.type !== 'equal').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <MetaLine style={{ marginBottom: 6 }}>
        {changedCount === 0 ? '変更はありません' : `${changedCount}行に変更があります（赤＝${leftLabel}、緑＝${rightLabel}）`}
      </MetaLine>
      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 6,
        fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
      }}
      >
        <div style={{
          display: 'grid', gridTemplateColumns: '40px 1fr 40px 1fr', position: 'sticky', top: 0,
          background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', fontWeight: 600, zIndex: 1,
        }}
        >
          <div style={{ padding: '4px 6px' }}>#</div>
          <div style={{ padding: '4px 6px' }}>{leftLabel}</div>
          <div style={{ padding: '4px 6px' }}>#</div>
          <div style={{ padding: '4px 6px' }}>{rightLabel}</div>
        </div>
        {rows.map((row, index) => {
          const colors = ROW_STYLES[row.type];
          return (
            // 行そのものに一意な値は無い（同じ文言の行が繰り返し出てくる）ので、
            // 並び順をそのままキーにする（差分の結果は再計算のたびに先頭から作り直される）。
            // eslint-disable-next-line react/no-array-index-key
            <div key={index} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 40px 1fr' }}>
              <div style={{ padding: '2px 6px', color: '#9ca3af', textAlign: 'right', background: colors.left }}>{row.leftNumber || ''}</div>
              <div style={{ padding: '2px 6px', background: colors.left, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{row.left}</div>
              <div style={{ padding: '2px 6px', color: '#9ca3af', textAlign: 'right', background: colors.right }}>{row.rightNumber || ''}</div>
              <div style={{ padding: '2px 6px', background: colors.right, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{row.right}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ContractDocumentRevision({ kind, entityId, document: target, onClose, onSaved }) {
  const { getText, editText, revise, check } = KIND_CONFIG[kind];

  const [doc, setDoc] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selection, setSelection] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('edit');
  // 差分の左側。既定は「生成直後」＝雛形に項目を差し込んだだけの状態で、
  // この契約書がどこまで標準から離れたかがひと目で分かる。
  const [diffBase, setDiffBase] = useState('generated');

  // AIが挙げた「直す箇所」。まだ下書きにも入っていない状態で、1件ずつ採否を決める。
  const [proposal, setProposal] = useState(null);
  const [chosen, setChosen] = useState({});
  // AIが「これは指示だけでは決まらない」と返してきた質問への回答。
  // 次に聞き直すときに前提として一緒に渡す。
  const [answers, setAnswers] = useState('');
  // 矛盾チェックの結果。
  const [checking, setChecking] = useState(false);
  const [issues, setIssues] = useState(null);

  const load = useCallback(() => {
    setError('');
    getText(entityId, target.id)
      .then((data) => {
        setDoc(data);
        setDraft(data.text);
        setSelection(null);
        setProposal(null);
        setIssues(null);
        setAnswers('');
        if (!data.originalText) setDiffBase('saved');
      })
      .catch((err) => setError(err.message));
  }, [entityId, target.id, getText]);

  useEffect(() => { load(); }, [load]);

  const dirty = !!doc && draft !== doc.text;
  const hasRange = !!selection && selection.end > selection.start;
  const selectedText = hasRange ? draft.slice(selection.start, selection.end) : '';

  // 契約書全体を見て、指示に関係する箇所を全部挙げてもらう。
  // 選択範囲があれば「気になっている箇所の手がかり」として一緒に渡すだけで、
  // そこだけを直させるわけではない（そこが今回の不具合の原因だった）。
  const handleAsk = async () => {
    if (!instruction.trim()) return;
    setAsking(true);
    setError('');
    setNotice('');
    try {
      const result = await revise(entityId, target.id, {
        text: draft,
        instruction,
        focus: hasRange ? selectedText : '',
        answers,
      });
      setProposal(result);
      // 既定は全部採用。落としたいものだけ人が外す。
      setChosen(Object.fromEntries(result.edits.map((_, index) => [index, true])));
      setTab('proposal');
      if (result.questions.length > 0) {
        setNotice(`${result.questions.length}件、指示だけでは決められないことがあります。先に答えてから作り直してください`);
      } else {
        setNotice(result.edits.length === 0
          ? 'AIは直すべき箇所を見つけられませんでした。指示を具体的にするか、手で直してください'
          : `${result.edits.length}箇所の提案があります。1件ずつ確認して、下書きに入れてください`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAsking(false);
    }
  };

  // 選んだ提案を下書きに入れる。後ろの箇所から当てる（1箇所入れると
  // それ以降の文字位置がズレるため）。Googleドキュメントにはまだ書き込まない。
  const handleApplyProposal = () => {
    const picked = proposal.edits
      .map((edit, index) => ({ edit, index }))
      .filter(({ index }) => chosen[index])
      .sort((a, b) => b.edit.flatStart - a.edit.flatStart);
    if (picked.length === 0) return;
    let next = draft;
    for (const { edit } of picked) {
      // 提案を作ったときの本文から動いていたら当てない（別の場所を壊すため）。
      if (next.slice(edit.flatStart, edit.flatEnd) !== edit.original) {
        setError('本文が変わったため、この提案は当てられません。もう一度AIに聞き直してください');
        return;
      }
      next = next.slice(0, edit.flatStart) + edit.replace + next.slice(edit.flatEnd);
    }
    setDraft(next);
    setProposal(null);
    setSelection(null);
    setTab('diff');
    setNotice(`${picked.length}箇所を下書きに入れました。全体の差分で確認して、よければ「変更を保存」を押してください`);
  };

  const handleCheck = async () => {
    setChecking(true);
    setError('');
    setNotice('');
    try {
      const result = await check(entityId, target.id, { text: draft });
      setIssues(result.issues);
      setNotice(result.issues.length === 0
        ? '通しで読んで、矛盾や直し忘れは見つかりませんでした'
        : `${result.issues.length}件の気になる箇所があります`);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      // 「どういう意図で直したか」の記録は1回の保存につき1件でよい。
      let noted = false;
      const { latest, count } = await applyDocumentEdits({
        baseText: doc.text,
        draftText: draft,
        edit: (data) => {
          const note = noted ? null : instruction.trim() || null;
          noted = true;
          return editText(entityId, target.id, { ...data, instruction: note });
        },
      });
      if (latest) {
        setDoc(latest);
        setDraft(latest.text);
        setSelection(null);
        setInstruction('');
        setAnswers('');
        setIssues(null);
        setNotice(`Googleドキュメントに保存しました（${count}箇所）。締結前に「矛盾チェック」も通してください`);
        if (onSaved) onSaved();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const busy = asking || saving || checking;
  const baseText = diffBase === 'generated' ? (doc && doc.originalText) || '' : (doc && doc.text) || '';
  const baseLabel = diffBase === 'generated' ? '生成直後' : '保存済み';
  const chosenCount = proposal ? proposal.edits.filter((_, index) => chosen[index]).length : 0;

  return (
    <SidePanelOverlay {...overlayDismiss(onClose)}>
      <SidePanel $width="min(1200px, 100vw)" style={{ overflowY: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 15, wordBreak: 'break-all' }}>{target.name}</div>
            <Button onClick={onClose}>閉じる</Button>
          </div>

          {error && !doc && (
            <div>
              <FieldError>{error}</FieldError>
              <Button type="button" style={{ marginTop: 6 }} onClick={load}>再読み込み</Button>
            </div>
          )}
          {!doc && !error && <EmptyNote>契約書を読み込み中...</EmptyNote>}

          {doc && (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button type="button" $variant={tab === 'edit' ? 'primary' : undefined} onClick={() => setTab('edit')}>本文を直す</Button>
                <Button type="button" $variant={tab === 'proposal' ? 'primary' : undefined} onClick={() => setTab('proposal')}>
                  AIの提案{proposal && proposal.edits.length > 0 ? `（${proposal.edits.length}）` : ''}
                </Button>
                <Button type="button" $variant={tab === 'diff' ? 'primary' : undefined} onClick={() => setTab('diff')}>
                  全体の差分{dirty ? '（未保存あり）' : ''}
                </Button>
                <div style={{ flex: 1 }} />
                <Button type="button" $variant="primary" disabled={!dirty || busy} onClick={handleSave}>
                  {saving ? '保存中...' : dirty ? '変更を保存' : '変更なし'}
                </Button>
                <Button type="button" disabled={!dirty || busy} onClick={() => { setDraft(doc.text); setSelection(null); setProposal(null); }}>
                  編集を取り消す
                </Button>
                <Button type="button" as="a" href={doc.url} target="_blank" rel="noopener noreferrer">Googleドキュメントで開く</Button>
              </div>
              {notice && <MetaLine style={{ color: '#92400e' }}>{notice}</MetaLine>}
              {error && <FieldError>{error}</FieldError>}

              {tab === 'edit' && (
                <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, flexWrap: 'wrap', overflowY: 'auto' }}>
                  <TextArea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onSelect={(e) => setSelection({ start: e.target.selectionStart, end: e.target.selectionEnd })}
                    disabled={busy}
                    style={{
                      flex: '2 1 420px', minWidth: 260, minHeight: 280, resize: 'none',
                      fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap',
                      background: dirty ? '#fffbeb' : undefined,
                    }}
                  />
                  <div style={{ flex: '1 1 260px', minWidth: 220, overflowY: 'auto' }}>
                    <MetaLine>
                      本文はこの場で直接書き換えられます。直すのはこの案件用に作った契約書だけで、
                      雛形は変わりません。
                    </MetaLine>

                    <Label style={{ marginTop: 12 }}>AIに渡している前提</Label>
                    {doc.facts.length === 0
                      ? (
                        <EmptyNote>
                          案件情報も差し込み項目も登録されていません。前提が無いとAIは書かれていないことを推測で埋めます。
                          案件の金額や実施期間を登録するか、指示文の中に前提を書いてください
                        </EmptyNote>
                      )
                      : (
                        <div style={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 4, padding: 6, maxHeight: 160, overflowY: 'auto' }}>
                          {doc.facts.map((f) => (
                            <div key={`${f.source}-${f.label}`} style={{ marginBottom: 2, wordBreak: 'break-all' }}>
                              <span style={{ color: '#6b7280' }}>{f.label}</span>：{f.value}
                            </div>
                          ))}
                        </div>
                      )}
                    <MetaLine style={{ marginTop: 4 }}>
                      ここに無いことはAIも知りません。実施期間や請求の回数など、効いてくる前提は指示文にも書いてください。
                    </MetaLine>

                    <Label style={{ marginTop: 12 }}>AIに直してもらう</Label>
                    <TextArea
                      rows={3}
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder="例：支払い条件は前払いではなく、9月末締め翌月末払いにして"
                      style={{ fontSize: 12 }}
                    />
                    <Button type="button" style={{ marginTop: 4 }} disabled={!instruction.trim() || busy} onClick={handleAsk}>
                      {asking ? '契約書全体を確認中...' : '契約書全体から直す箇所を探す'}
                    </Button>
                    <MetaLine style={{ marginTop: 4 }}>
                      契約書の<b>全文</b>を見て、指示に関係する箇所を全部挙げます。
                      同じ条件が料金の条項と支払条件の条項の両方に書かれていることがよくあり、
                      片方だけ直すと矛盾した契約書になるためです。
                      {hasRange && '（選んでいる部分は「気になっている箇所」の手がかりとして一緒に渡します）'}
                    </MetaLine>

                    <Label style={{ marginTop: 12 }}>締結前の見直し</Label>
                    <Button type="button" disabled={busy} onClick={handleCheck}>
                      {checking ? '通しで読んでいます...' : '矛盾チェック'}
                    </Button>
                    <MetaLine style={{ marginTop: 4 }}>
                      今の本文を通しで読んで、食い違っている記述・直し忘れ・空欄が残っていないかを報告します（書き換えはしません）。
                    </MetaLine>
                    {issues !== null && (
                      issues.length === 0
                        ? <EmptyNote>気になる箇所は見つかりませんでした</EmptyNote>
                        : issues.map((issue) => (
                          <div key={`${issue.lines.join('-')}-${issue.detail}`} style={{ marginTop: 6, padding: 6, borderRadius: 4, background: issue.severity === 'high' ? '#fee2e2' : '#f3f4f6', fontSize: 12 }}>
                            <Badge>{issue.lines.length > 0 ? `${issue.lines.join('・')}行目` : '全体'}</Badge>
                            <div style={{ marginTop: 4 }}>{issue.detail}</div>
                          </div>
                        ))
                    )}

                    {doc.revisions.length > 0 && (
                      <>
                        <Label style={{ marginTop: 12 }}>これまでの修正</Label>
                        {doc.revisions.slice().reverse().map((r) => (
                          <MetaLine key={`${r.at}-${r.instruction || ''}`} style={{ marginTop: 2 }}>
                            {new Date(r.at).toLocaleString('ja-JP')}　{r.instruction || '（手直し）'}
                          </MetaLine>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}

              {tab === 'proposal' && (
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {!proposal && <EmptyNote>「本文を直す」で指示を出すと、直す箇所の一覧がここに出ます</EmptyNote>}
                  {proposal && (
                    <>
                      {/* 指示だけでは決まらないこと。ここを答えずに提案を当てると、
                          AIが推測で埋めた条項がそのまま契約書に入る。 */}
                      {proposal.questions.length > 0 && (
                        <div style={{ marginBottom: 10, padding: 10, borderRadius: 6, background: '#fee2e2', border: '1px solid #fca5a5' }}>
                          <Label style={{ margin: 0 }}>先に決めてください（指示だけでは決まりません）</Label>
                          {proposal.questions.map((q) => (
                            <div key={q} style={{ fontSize: 12, marginTop: 4 }}>・{q}</div>
                          ))}
                          <TextArea
                            rows={3}
                            value={answers}
                            onChange={(e) => setAnswers(e.target.value)}
                            placeholder="例：一括請求です。実施は8月からで、請求は実施完了後の1回だけ"
                            style={{ fontSize: 12, marginTop: 6 }}
                          />
                          <Button type="button" style={{ marginTop: 4 }} disabled={!answers.trim() || busy} onClick={handleAsk}>
                            {asking ? '作り直しています...' : '回答して作り直す'}
                          </Button>
                          <MetaLine style={{ marginTop: 4 }}>
                            答えずに下の提案を当てると、AIが推測で埋めた条項がそのまま入ります。
                          </MetaLine>
                        </div>
                      )}
                      {proposal.warnings.length > 0 && (
                        <div style={{ marginBottom: 10, padding: 8, borderRadius: 6, background: '#fef3c7' }}>
                          <Label style={{ margin: 0 }}>AIからの申し送り</Label>
                          {proposal.warnings.map((w) => (
                            <MetaLine key={w} style={{ marginTop: 2 }}>・{w}</MetaLine>
                          ))}
                        </div>
                      )}
                      {proposal.edits.length === 0
                        ? <EmptyNote>直す箇所は挙がりませんでした</EmptyNote>
                        : (
                          <>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                              <Button
                                type="button"
                                $variant={proposal.questions.length > 0 ? undefined : 'primary'}
                                disabled={chosenCount === 0}
                                onClick={handleApplyProposal}
                              >
                                選んだ{chosenCount}箇所を下書きに入れる
                              </Button>
                              <Button type="button" onClick={() => setChosen(Object.fromEntries(proposal.edits.map((_, i) => [i, true])))}>全部選ぶ</Button>
                              <Button type="button" onClick={() => setChosen({})}>全部外す</Button>
                              <MetaLine>下書きに入れるだけで、Googleドキュメントにはまだ書き込みません</MetaLine>
                            </div>
                            {proposal.edits.map((edit, index) => (
                              <div key={`${edit.startLine}-${edit.flatStart}`} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={!!chosen[index]}
                                    onChange={(e) => setChosen({ ...chosen, [index]: e.target.checked })}
                                  />
                                  <Badge>
                                    {edit.startLine === edit.endLine ? `${edit.startLine}行目` : `${edit.startLine}〜${edit.endLine}行目`}
                                  </Badge>
                                  <span style={{ fontSize: 12, color: '#374151' }}>{edit.reason || '（理由なし）'}</span>
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6, fontFamily: 'monospace', fontSize: 12 }}>
                                  <div style={{ background: '#fee2e2', padding: 6, borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{edit.original}</div>
                                  <div style={{ background: '#dcfce7', padding: 6, borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{edit.replace}</div>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                    </>
                  )}
                </div>
              )}

              {tab === 'diff' && (
                <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Label style={{ margin: 0 }}>左に出すもの</Label>
                    <Button
                      type="button"
                      $variant={diffBase === 'generated' ? 'primary' : undefined}
                      disabled={!doc.originalText}
                      onClick={() => setDiffBase('generated')}
                    >
                      生成直後
                    </Button>
                    <Button type="button" $variant={diffBase === 'saved' ? 'primary' : undefined} onClick={() => setDiffBase('saved')}>
                      保存済み
                    </Button>
                    {!doc.originalText && <MetaLine>この契約書は生成直後の本文が残っていないため、保存済みとだけ比べられます</MetaLine>}
                  </div>
                  <DiffView leftText={baseText} rightText={draft} leftLabel={baseLabel} rightLabel={dirty ? '今の下書き' : '今の本文'} />
                </>
              )}
            </>
          )}
        </div>
      </SidePanel>
    </SidePanelOverlay>
  );
}
