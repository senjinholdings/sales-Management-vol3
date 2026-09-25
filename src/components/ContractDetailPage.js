import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PageWrap, PageTitle, PageHeader, Section, SectionTitle, MetaLine, Button, Input, Select, TextArea,
  FormField, FormGrid, Label, FieldError, EmptyNote, ActionGroup, Badge,
} from './contractUi.js';
import { toDate, formatDateTime } from '../utils/contractDates.js';
import { api } from '../services/contractApi.js';
import ContractTemplateMarkup from './ContractTemplateMarkup.js';

// 「よく使う項目をまとめて追加」で一括登録する項目。ダイソー予算型（広告・PR表記あり）の
// 締結依頼で必要になった項目セットだが、他の契約書でもよく使うと想定して汎用ボタンにしてある。
const COMMON_REQUEST_FIELD_LABELS = [
  'プロモーション対象', '実施期間', '料金', '保証投稿数', '保証インプレッション数', '支払期日',
];

// 雛形への{{項目名}}マーク付けはGoogleドキュメントにしかできない
// （契約書マスタにはPDFやWordのURLも登録できるため）。
const isGoogleDoc = (url) => /docs\.google\.com\/document\/d\//.test(String(url || ''));

// 入力項目を編集中に一意なReactキーとして使うためだけの値。サーバーに送るidとは別物
// (サーバー側はlabelを見てid未設定の項目にだけ新規採番する)。
let nextFieldKey = 0;
const makeFieldKey = () => {
  nextFieldKey += 1;
  return `f${Date.now()}-${nextFieldKey}`;
};

// 契約書1件（＝同じ契約書名のバージョン群）の詳細ページ。
// 種別・入力項目・雛形のマーク付け・バージョン履歴はこの契約書だけの話なので、
// 一覧のカードに詰め込まずここで行う（一覧側は「何があるか」を見るだけにする）。
export default function ContractDetailPage() {
  const { groupKey: encodedGroupKey } = useParams();
  const groupKey = decodeURIComponent(encodedGroupKey || '');
  const navigate = useNavigate();

  const [contracts, setContracts] = useState(null);
  const [presets, setPresets] = useState([]);
  const [error, setError] = useState('');

  const [kind, setKind] = useState('individual');
  const [fields, setFields] = useState([]);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaError, setMetaError] = useState('');
  const [metaSaved, setMetaSaved] = useState(false);

  // 契約書名の変更。名前はバージョン群のまとめ役なので、変えると全バージョンが
  // まとめて付け替わり、このページのURL(groupKey)も変わる。
  const [renaming, setRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState('');

  const [copying, setCopying] = useState(false);
  // マーク付けパネルを開いている契約書。通常は現在の版だが、パネルの中で
  // Googleドキュメントへの変換をしたときは、作られた新しい版に切り替える
  // （切り替えないと、開けなかった古い版のまま開き続けることになる）。
  const [markupContract, setMarkupContract] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  // この契約書の新しいバージョンを登録する。契約書名はこのページで固定されている。
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    api.listContracts()
      .then((list) => {
        const mine = list.filter((c) => c.groupKey === groupKey).sort((a, b) => b.version - a.version);
        setContracts(mine);
        const cur = mine[0];
        if (cur) {
          setKind(cur.kind === 'basic' ? 'basic' : 'individual');
          setFields((cur.requestFields || []).map((f) => ({ ...f, _key: makeFieldKey() })));
        }
      })
      .catch((err) => setError(err.message));
  }, [groupKey]);

  useEffect(() => { load(); }, [load]);
  const loadPresets = useCallback(
    () => api.listContractFieldPresets().then(setPresets).catch(() => setPresets([])),
    [],
  );
  useEffect(() => { loadPresets(); }, [loadPresets]);

  const current = contracts?.[0] || null;
  const history = contracts?.slice(1) || [];

  // 入力項目が空のときに、この契約書の別の版から取り込めるようにする。
  // 以前は雛形の文章を直すと入力項目が{{項目名}}だけから作り直され、手で登録した項目が
  // まるごと消えていた（不具合自体はサーバー側で直したが、すでに消えてしまったものは
  // 前の版から戻すしかない）。版を並べて新しいほうから探す。
  const recoverableFrom = fields.length === 0
    ? (contracts || []).find((c) => Array.isArray(c.requestFields) && c.requestFields.length > 0)
    : null;

  const updateField = (key, patch) => {
    setFields((prev) => prev.map((f) => (f._key === key ? { ...f, ...patch } : f)));
    setMetaSaved(false);
  };

  // 既に同じラベルの項目があるものは重ねて追加しない(ボタンを再度押しても増殖しないように)。
  const addCommonFields = () => {
    const existing = new Set(fields.map((f) => f.label.trim()));
    const toAdd = COMMON_REQUEST_FIELD_LABELS.filter((label) => !existing.has(label));
    if (toAdd.length === 0) return;
    setFields((prev) => [...prev, ...toAdd.map((label) => ({ label, required: true, _key: makeFieldKey() }))]);
    setMetaSaved(false);
  };

  const handleRename = async () => {
    const next = renameInput.trim();
    if (!next) {
      setRenameError('新しい契約書名を入力してください');
      return;
    }
    setRenameSaving(true);
    setRenameError('');
    try {
      const result = await api.renameContract(groupKey, next);
      // groupKeyが変わるので、新しいURLに移る(そのまま残ると「見つかりませんでした」になる)。
      setRenaming(false);
      navigate(`/contract-master/${encodeURIComponent(result.groupKey)}`, { replace: true });
    } catch (err) {
      setRenameError(err.message);
    } finally {
      setRenameSaving(false);
    }
  };

  const handleSaveMeta = async () => {
    if (fields.some((f) => !f.label.trim())) {
      setMetaError('項目名を入力してください');
      return;
    }
    setMetaSaving(true);
    setMetaError('');
    try {
      await api.updateContract(current.id, {
        kind,
        requestFields: fields.map((f) => ({ id: f.id, label: f.label.trim(), required: f.required !== false })),
      });
      setMetaSaved(true);
      load();
    } catch (err) {
      setMetaError(err.message);
    } finally {
      setMetaSaving(false);
    }
  };

  const handleMarkupCopy = async () => {
    setCopying(true);
    setError('');
    try {
      // 作られた版をそのまま開く。load()の完了を待たずに現在の版を渡すと、
      // 複製元（＝まだマークを付けられない版）を開いてしまう。
      const created = await api.createContractMarkupCopy(current.id);
      setMarkupContract(created);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCopying(false);
    }
  };

  const handleAddVersion = async (e) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('リンクを入力してください');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.createContract({ name: current.name, url: url.trim(), note: note.trim() || undefined });
      setUrl('');
      setNote('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async (c) => {
    try {
      await navigator.clipboard.writeText(c.url);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId((v) => (v === c.id ? null : v)), 2000);
    } catch (err) {
      setError('コピーに失敗しました');
    }
  };

  const versionLine = (c) => (
    <div key={c.id} style={{ marginTop: 6 }}>
      <MetaLine>
        v{c.version}
        {c.createdAt && `・${formatDateTime(toDate(c.createdAt))}`}
        {c.note && `・${c.note}`}
      </MetaLine>
      <div style={{ fontSize: 13, marginTop: 2, wordBreak: 'break-all' }}>
        <a href={c.url} target="_blank" rel="noopener noreferrer">{c.url}</a>
      </div>
      <Button type="button" style={{ marginTop: 4 }} onClick={() => handleCopyLink(c)}>
        {copiedId === c.id ? 'コピーしました' : 'リンクをコピーする'}
      </Button>
    </div>
  );

  if (contracts === null) return <PageWrap><EmptyNote>読み込み中...</EmptyNote></PageWrap>;
  if (!current) {
    return (
      <PageWrap>
        <EmptyNote>この契約書は見つかりませんでした</EmptyNote>
        <Button style={{ marginTop: 8 }} onClick={() => navigate('/contract-master')}>契約書一覧へ戻る</Button>
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      <PageHeader>
        {renaming ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 320px' }}>
            <Input
              value={renameInput}
              onChange={(e) => { setRenameInput(e.target.value); setRenameError(''); }}
              placeholder="新しい契約書名"
              style={{ flex: '1 1 220px' }}
            />
            <Button $variant="primary" disabled={renameSaving} onClick={handleRename}>
              {renameSaving ? '変更中...' : '変更'}
            </Button>
            <Button disabled={renameSaving} onClick={() => { setRenaming(false); setRenameError(''); }}>
              キャンセル
            </Button>
          </div>
        ) : (
          <PageTitle style={{ margin: 0 }}>{current.name}</PageTitle>
        )}
        <ActionGroup>
          {!renaming && (
            <Button onClick={() => { setRenameInput(current.name); setRenaming(true); setRenameError(''); }}>
              名前を変更
            </Button>
          )}
          <Button onClick={() => navigate('/contract-master')}>契約書一覧へ戻る</Button>
        </ActionGroup>
      </PageHeader>
      {renaming && (
        <MetaLine style={{ marginBottom: 8 }}>
          この契約書の全バージョン（{contracts.length}件）の名前をまとめて変更します。
          締結依頼で選ぶときの表示名も変わります。すでに送った依頼に記録されている契約書名はそのまま残ります。
        </MetaLine>
      )}
      {renameError && <FieldError style={{ marginBottom: 8 }}>{renameError}</FieldError>}
      {(current.pastNames || []).length > 0 && !renaming && (
        <MetaLine style={{ marginBottom: 8 }}>以前の名前：{(current.pastNames || []).join('、')}</MetaLine>
      )}

      <Section>
        <SectionTitle>現在の版</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Badge $bg={kind === 'basic' ? '#dbeafe' : '#f3f4f6'} $color={kind === 'basic' ? '#1e40af' : '#374151'}>
            {kind === 'basic' ? '基本契約書' : '個別契約書'}
          </Badge>
          {current.isMarkupCopy && <Badge $bg="#dcfce7" $color="#166534">項目入り版</Badge>}
        </div>
        {versionLine(current)}
        {history.length > 0 && (
          <>
            <Button type="button" style={{ marginTop: 8 }} onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? '過去バージョンを隠す' : `過去バージョンを見る（${history.length}件）`}
            </Button>
            {showHistory && <div style={{ marginTop: 4 }}>{history.map(versionLine)}</div>}
          </>
        )}
        {error && <FieldError>{error}</FieldError>}
      </Section>

      <Section>
        <SectionTitle>依頼設定</SectionTitle>
        <MetaLine style={{ marginBottom: 8 }}>
          種別と入力項目は契約書の内容そのものではなく「どう依頼するか」の設定なので、
          バージョンを増やさず現在の版に上書きします。
        </MetaLine>
        <FormField>
          <Label>種別</Label>
          <Select value={kind} onChange={(e) => { setKind(e.target.value); setMetaSaved(false); }}>
            <option value="individual">個別契約書</option>
            <option value="basic">基本契約書</option>
          </Select>
          <MetaLine style={{ marginTop: 4 }}>
            基本契約書を選ぶと、締結依頼の画面で個別契約書を併せて選べるようになります。
          </MetaLine>
        </FormField>
        <FormField>
          <Label>入力項目（締結依頼時に入力してもらう項目）</Label>
          {fields.length === 0 && <EmptyNote>入力項目はまだありません</EmptyNote>}
          {recoverableFrom && (
            <div style={{ marginTop: 6 }}>
              <Button
                type="button"
                onClick={() => {
                  setFields(recoverableFrom.requestFields.map((f) => ({ ...f, _key: makeFieldKey() })));
                  setMetaSaved(false);
                }}
              >
                第{recoverableFrom.version}版の入力項目を取り込む（{recoverableFrom.requestFields.length}件）
              </Button>
              <MetaLine style={{ marginTop: 4 }}>
                取り込んだあと「依頼設定を保存」を押すと、この版の入力項目になります。
              </MetaLine>
            </div>
          )}
          {fields.map((f) => (
            <div key={f._key} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
              <Input
                value={f.label}
                onChange={(e) => updateField(f._key, { label: e.target.value })}
                placeholder="項目名（例: 実施期間）"
                style={{ flex: 1 }}
              />
              <Label style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 0, whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={f.required !== false}
                  onChange={(e) => updateField(f._key, { required: e.target.checked })}
                />
                必須
              </Label>
              <Button
                type="button"
                $variant="danger"
                onClick={() => { setFields((prev) => prev.filter((x) => x._key !== f._key)); setMetaSaved(false); }}
              >
                削除
              </Button>
            </div>
          ))}
          <ActionGroup style={{ marginTop: 8 }}>
            <Button
              type="button"
              onClick={() => { setFields((prev) => [...prev, { label: '', required: true, _key: makeFieldKey() }]); setMetaSaved(false); }}
            >
              ＋項目を追加
            </Button>
            <Button type="button" onClick={addCommonFields}>よく使う項目をまとめて追加</Button>
          </ActionGroup>
        </FormField>
        <ActionGroup style={{ marginTop: 8 }}>
          <Button type="button" $variant="primary" onClick={handleSaveMeta} disabled={metaSaving}>
            {metaSaving ? '保存中...' : '依頼設定を保存'}
          </Button>
          {metaSaved && <MetaLine style={{ color: '#15803d' }}>保存しました</MetaLine>}
        </ActionGroup>
        {metaError && <FieldError>{metaError}</FieldError>}
      </Section>

      {isGoogleDoc(current.url) && (
        <Section>
          <SectionTitle>雛形の項目マーク付け</SectionTitle>
          {current.isMarkupCopy ? (
            <>
              <MetaLine style={{ marginBottom: 8 }}>
                雛形の中の文字を選んで{'{{項目名}}'}に置き換えます。置き換えた項目は、上の入力項目に自動で反映されます。
              </MetaLine>
              <Button type="button" onClick={() => setMarkupContract(current)}>雛形に項目をマークする</Button>
            </>
          ) : (
            <>
              <MetaLine style={{ marginBottom: 8 }}>
                元の雛形は書き換えません。複製した「項目入り版」を新しいバージョンとして作り、そちらにマークを付けます。
              </MetaLine>
              <Button type="button" disabled={copying} onClick={handleMarkupCopy}>
                {copying ? '作成中...' : '項目入り版を作る'}
              </Button>
            </>
          )}
        </Section>
      )}

      <Section as="form" onSubmit={handleAddVersion}>
        <SectionTitle>新しいバージョンを登録</SectionTitle>
        <MetaLine style={{ marginBottom: 8 }}>
          契約書の中身を更新したときに登録します。上書きはせず、古いバージョンは履歴として残ります。
        </MetaLine>
        <FormGrid>
          <FormField>
            <Label>リンク（Googleドキュメント等）</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/document/..." />
          </FormField>
          <FormField>
            <Label>メモ（任意）</Label>
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="何を変更したか（例: 料金条項を更新）" />
          </FormField>
        </FormGrid>
        <ActionGroup style={{ marginTop: 8 }}>
          <Button type="submit" $variant="primary" disabled={submitting}>
            {submitting ? '登録中...' : '新しいバージョンとして登録'}
          </Button>
        </ActionGroup>
      </Section>

      {markupContract && (
        <ContractTemplateMarkup
          contract={markupContract}
          presets={presets}
          onPresetAdded={loadPresets}
          onRequestFieldsUpdated={(next) => setFields(next.map((f) => ({ ...f, _key: makeFieldKey() })))}
          onConverted={(created) => { setMarkupContract(created); load(); }}
          onClose={() => { setMarkupContract(null); load(); }}
        />
      )}
    </PageWrap>
  );
}
