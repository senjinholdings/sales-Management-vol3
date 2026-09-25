import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageWrap, PageTitle, Section, SectionTitle, MetaLine, Button, Input, Select, TextArea,
  FormField, FormGrid, Label, FieldError, EmptyNote, ActionGroup, CardGrid, Badge,
} from './contractUi.js';
import { api } from '../services/contractApi.js';
import { readFileAsBase64 } from '../utils/readFileAsBase64.js';
import { fetchAllStaff } from '../services/staffService.js';

// 契約書の一覧。更新は上書きせず常に新しいバージョンを追加していく方式
// (現在の版はグループ内でversion最大のもの)。URLの登録もできるが、手元のファイルをそのまま登録もできる
// (アップロードした分はサーバー側でDriveに置き、そのリンクを登録する)。
//
// 種別・入力項目・雛形のマーク付け・バージョン履歴は契約書1件ごとの話なので、
// ここには置かず詳細ページ(ContractDetailPage.js)で行う。全部を一覧のカードに
// 詰め込むと、契約書が増えるほど何がどれの設定なのか分からなくなるため。
// この画面に残すのは、全契約書に共通するもの(入力項目マスタ・共通設定)と、
// 新規登録・一覧だけにする。
// サーバー側の上限(functions/contractsRouter.js の UPLOAD_MAX_BYTES)と同じ。
// 送ってから断られるより、選んだ時点で分かるほうがよいのでここでも見る。
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export default function ContractsSettingsPage() {
  const navigate = useNavigate();
  const [contracts, setContracts] = useState(null);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 雛形の渡し方。'link'は今まで通りURLを登録するだけ、'upload'は手元のファイルを
  // Driveに置いてそのリンクを登録する。
  const [source, setSource] = useState('link');
  const [file, setFile] = useState(null);

  // 既存の契約書名を選ぶか、新しい契約書名を入力するかを切り替える。
  // 同じ名前で登録すると新しいバージョンになる、という媒体資料管理の「サービス名」と同じ考え方。
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');


  // 入力項目名のマスタ（全契約書で共有）。雛形のマーク付けで選ぶ選択肢になる。
  const [presets, setPresets] = useState([]);
  const [presetLabel, setPresetLabel] = useState('');
  const [presetError, setPresetError] = useState('');

  // 全契約書に共通する設定。
  //  - Googleドキュメントを操作するアカウント: このアプリはGoogleでログインしないため、
  //    雛形の複製・記入済み契約書の作成などはここで選んだ社内アカウントとして行う
  //  - 記入済み契約書の保存先Driveフォルダ: 案件をまたいで1つのフォルダに集める
  //  - テストグループ: 「テストグループに送る」を選んだときの投稿先Slackチャンネル
  const [settings, setSettings] = useState(null); // { folderId, folderUrl, googleAccountEmail, testChannelId }
  const [folderInput, setFolderInput] = useState('');
  const [accountInput, setAccountInput] = useState('');
  const [testChannelInput, setTestChannelInput] = useState('');
  const [staffWithEmail, setStaffWithEmail] = useState([]);
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderError, setFolderError] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  const load = useCallback(() => {
    api.listContracts().then((list) => {
      setContracts(list);
      const names = [...new Set(list.map((c) => c.name))].sort((a, b) => a.localeCompare(b, 'ja'));
      setName((current) => current || names[0] || '');
    }).catch((err) => setError(err.message));
  }, []);

  // 契約書名(groupKey)ごとにまとめ、グループ内はバージョンの新しい順。
  const groups = {};
  (contracts || []).forEach((c) => {
    if (!groups[c.groupKey]) groups[c.groupKey] = [];
    groups[c.groupKey].push(c);
  });
  Object.values(groups).forEach((list) => list.sort((a, b) => b.version - a.version));

  const groupRows = Object.values(groups)
    .map((list) => ({ groupKey: list[0].groupKey, name: list[0].name, list }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const existingNames = groupRows.map((g) => g.name);

  const loadPresets = useCallback(() => {
    api.listContractFieldPresets().then(setPresets).catch((err) => setPresetError(err.message));
  }, []);

  const applySettings = (data) => {
    setSettings(data);
    setFolderInput(data.folderUrl);
    setAccountInput(data.googleAccountEmail || '');
    setTestChannelInput(data.testChannelId || '');
  };

  const loadSettings = useCallback(() => {
    api.getContractSettings()
      .then(applySettings)
      .catch((err) => setFolderError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadPresets(); }, [loadPresets]);
  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => {
    fetchAllStaff()
      .then((staff) => setStaffWithEmail(staff.filter((s) => s.email)))
      .catch(() => setStaffWithEmail([]));
  }, []);

  const handleSaveFolder = async (e) => {
    e.preventDefault();
    setFolderSaving(true);
    setFolderError('');
    setSettingsSaved(false);
    try {
      const data = await api.saveContractSettings({
        folderId: folderInput,
        googleAccountEmail: accountInput,
        testChannelId: testChannelInput,
      });
      applySettings(data);
      setSettingsSaved(true);
    } catch (err) {
      setFolderError(err.message);
    } finally {
      setFolderSaving(false);
    }
  };

  const handleAddPreset = async (e) => {
    e.preventDefault();
    const label = presetLabel.trim();
    if (!label) return;
    setPresetError('');
    try {
      await api.createContractFieldPreset(label);
      setPresetLabel('');
      loadPresets();
    } catch (err) {
      setPresetError(err.message);
    }
  };

  const handleDeletePreset = async (id) => {
    setPresetError('');
    try {
      await api.deleteContractFieldPreset(id);
      loadPresets();
    } catch (err) {
      setPresetError(err.message);
    }
  };

  // 元の雛形を複製して項目入り版を作り、そのままマーク付け画面を開く。
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const targetName = (addingNew ? newName : name).trim();
    if (!targetName) {
      setError('契約書名を入力してください');
      return;
    }
    if (source === 'link' && !url.trim()) {
      setError('リンクを入力してください');
      return;
    }
    if (source === 'upload' && !file) {
      setError('ファイルを選択してください');
      return;
    }
    if (source === 'upload' && file.size > UPLOAD_MAX_BYTES) {
      setError('ファイルサイズが大きすぎます（8MBまで）');
      return;
    }
    setSubmitting(true);
    try {
      if (source === 'upload') {
        await api.uploadContract({
          name: targetName,
          fileName: file.name,
          // 拡張子からブラウザが種類を判断できないこともあるので、その時はサーバー側の
          // 既定(変換しない)に任せる。
          mimeType: file.type || undefined,
          fileDataBase64: await readFileAsBase64(file),
          note: note.trim() || undefined,
        });
      } else {
        await api.createContract({
          name: targetName,
          url: url.trim(),
          note: note.trim() || undefined,
        });
      }
      setName(targetName);
      setNewName('');
      setAddingNew(false);
      setUrl('');
      setNote('');
      setFile(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageWrap>
      <PageTitle>契約書管理</PageTitle>
      <MetaLine style={{ marginBottom: 12 }}>
        契約書の雛形を管理します。リンク（Googleドキュメント等）の登録と、手元のファイルのアップロードのどちらでも登録できます。
        契約書名の変更・種別・入力項目・雛形のマーク付けは、契約書ごとの詳細ページで設定します。
      </MetaLine>

      <Section as="form" onSubmit={handleSubmit}>
        <SectionTitle>新しいバージョンを登録</SectionTitle>
        <FormGrid>
          <FormField>
            <Label>契約書名（必須）</Label>
            {addingNew ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新しい契約書名" style={{ flex: 1 }} />
                {existingNames.length > 0 && (
                  <Button type="button" onClick={() => { setAddingNew(false); setNewName(''); }}>キャンセル</Button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <Select value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }}>
                  {existingNames.length === 0 && <option value="">（未登録）</option>}
                  {existingNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
                <Button type="button" onClick={() => setAddingNew(true)}>＋新規契約書</Button>
              </div>
            )}
            <MetaLine style={{ marginTop: 4 }}>
              既存の契約書名を選んで登録すると、その契約書の新しいバージョンとして追加されます。
            </MetaLine>
          </FormField>
          <FormField>
            <Label>雛形</Label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <Button
                type="button"
                $variant={source === 'link' ? 'primary' : undefined}
                onClick={() => { setSource('link'); setError(''); }}
              >
                リンクを登録
              </Button>
              <Button
                type="button"
                $variant={source === 'upload' ? 'primary' : undefined}
                onClick={() => { setSource('upload'); setError(''); }}
              >
                ファイルをアップロード
              </Button>
            </div>
            {source === 'link' ? (
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/document/..." />
            ) : (
              <>
                <input
                  type="file"
                  accept=".docx,.doc,.odt,.rtf,.txt,.pdf"
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }}
                  style={{ fontSize: 13 }}
                />
                <MetaLine style={{ marginTop: 4 }}>
                  Word（.docx/.doc）などはGoogleドキュメントに変換して保存するので、そのまま
                  {'{{項目名}}'}のマーク付けに進めます。PDFは変換すると中身が崩れるためそのまま保存します（マーク付けはできません）。
                  保存先は下の「記入済み契約書の保存先」フォルダの中の「契約書雛形」フォルダです。8MBまで。
                </MetaLine>
              </>
            )}
          </FormField>
          <FormField>
            <Label>メモ（任意）</Label>
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="何を変更したか（例: 料金条項を更新）" />
          </FormField>
        </FormGrid>
        <ActionGroup style={{ marginTop: 8 }}>
          <Button type="submit" $variant="primary" disabled={submitting}>
            {submitting
              ? (source === 'upload' ? 'アップロード中...' : '登録中...')
              : '新しいバージョンとして登録'}
          </Button>
        </ActionGroup>
        {error && <FieldError>{error}</FieldError>}
      </Section>

      <Section as="form" onSubmit={handleSaveFolder}>
        <SectionTitle>共通設定</SectionTitle>
        <FormGrid>
          <FormField>
            <Label>Googleドキュメントを操作するアカウント</Label>
            <Select value={accountInput} onChange={(e) => { setAccountInput(e.target.value); setSettingsSaved(false); }}>
              <option value="">（未設定）</option>
              {accountInput && !staffWithEmail.some((s) => s.email === accountInput) && (
                <option value={accountInput}>{accountInput}</option>
              )}
              {staffWithEmail.map((s) => (
                <option key={s.id} value={s.email}>{s.name}（{s.email}）</option>
              ))}
            </Select>
            <MetaLine style={{ marginTop: 2 }}>
              雛形の登録・項目入り版づくり・記入済み契約書の作成と修正は、このアカウントとして行います
              （作ったファイルの持ち主もこのアカウントになります）。リンクで登録する雛形は、
              このアカウントが開けるようにしておいてください。担当者マスターでメールアドレスを登録した人から選べます。
            </MetaLine>
          </FormField>
          <FormField>
            <Label>記入済み契約書の保存先</Label>
            <Input
              value={folderInput}
              onChange={(e) => { setFolderInput(e.target.value); setSettingsSaved(false); }}
              placeholder="https://drive.google.com/drive/folders/..."
            />
            <MetaLine style={{ marginTop: 2 }}>
              締結依頼のときに作る「記入済み契約書」の置き場所です。案件をまたいでこの1つのフォルダに集めます。
              上のアカウントから書き込める必要があります。
              {settings && (
                <>
                  <br />
                  現在の保存先：<a href={settings.folderUrl} target="_blank" rel="noopener noreferrer">{settings.folderUrl}</a>
                </>
              )}
            </MetaLine>
          </FormField>
          <FormField>
            <Label>テストグループ（SlackのチャンネルID）</Label>
            <Input
              value={testChannelInput}
              onChange={(e) => { setTestChannelInput(e.target.value); setSettingsSaved(false); }}
              placeholder="C0123456789"
            />
            <MetaLine style={{ marginTop: 2 }}>
              締結依頼で「テストグループに送る」を選んだときの送り先です。未設定のままテスト送信を選ぶと、
              本番には送らずにエラーで止めます。
            </MetaLine>
          </FormField>
        </FormGrid>
        <ActionGroup style={{ marginTop: 8 }}>
          <Button type="submit" $variant="primary" disabled={folderSaving || !folderInput.trim()}>
            {folderSaving ? '保存中...' : '保存'}
          </Button>
          {settingsSaved && <MetaLine>保存しました</MetaLine>}
        </ActionGroup>
        {folderError && <FieldError>{folderError}</FieldError>}
      </Section>

      <Section>
        <SectionTitle>入力項目マスタ</SectionTitle>
        <MetaLine style={{ marginBottom: 8 }}>
          雛形の中を{'{{項目名}}'}に置き換えるときに選べる項目名です。すべての契約書で共有します。
        </MetaLine>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {presets.length === 0 && <EmptyNote>まだ登録されていません</EmptyNote>}
          {presets.map((p) => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #e5e7eb', borderRadius: 12, padding: '2px 4px 2px 10px', fontSize: 12 }}>
              {p.label}
              <Button type="button" $variant="danger" onClick={() => handleDeletePreset(p.id)}>削除</Button>
            </span>
          ))}
        </div>
        <form onSubmit={handleAddPreset} style={{ display: 'flex', gap: 6 }}>
          <Input value={presetLabel} onChange={(e) => setPresetLabel(e.target.value)} placeholder="項目名（例: 実施期間）" style={{ flex: 1, maxWidth: 260 }} />
          <Button type="submit" disabled={!presetLabel.trim()}>＋追加</Button>
        </form>
        {presetError && <FieldError>{presetError}</FieldError>}
      </Section>

      <Section>
        <SectionTitle>契約書一覧</SectionTitle>
        {contracts === null && <EmptyNote>読み込み中...</EmptyNote>}
        {contracts !== null && groupRows.length === 0 && (
          <EmptyNote>契約書はまだ登録されていません（上のフォームから追加できます）</EmptyNote>
        )}
        {contracts !== null && groupRows.length > 0 && (
          <CardGrid>
            {groupRows.map(({ groupKey, name: label, list }) => {
              const current = list[0];
              return (
                <div key={groupKey} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
                  {current ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        <Badge $bg={current.kind === 'basic' ? '#dbeafe' : '#f3f4f6'} $color={current.kind === 'basic' ? '#1e40af' : '#374151'}>
                          {current.kind === 'basic' ? '基本契約書' : '個別契約書'}
                        </Badge>
                        {current.isMarkupCopy && <Badge $bg="#dcfce7" $color="#166534">項目入り版</Badge>}
                        <MetaLine>v{current.version}・入力項目{(current.requestFields || []).length}件</MetaLine>
                      </div>
                      <div style={{ fontSize: 13, marginTop: 4, wordBreak: 'break-all' }}>
                        <a href={current.url} target="_blank" rel="noopener noreferrer">{current.url}</a>
                      </div>
                    </>
                  ) : <MetaLine style={{ color: '#b91c1c' }}>未登録</MetaLine>}
                  <Button
                    type="button"
                    style={{ marginTop: 8 }}
                    onClick={() => navigate(`/contract-master/${encodeURIComponent(groupKey)}`)}
                  >
                    詳細・依頼設定を開く
                  </Button>
                </div>
              );
            })}
          </CardGrid>
        )}
      </Section>
    </PageWrap>
  );
}
