import { useCallback, useEffect, useState } from 'react';
import {
  PageWrap, PageTitle, Section, SectionTitle, MetaLine, Button, Input, Select,
  FormField, FormGrid, Label, FieldError, EmptyNote, ActionGroup, CardGrid, Badge,
} from './contractUi.js';
import { api } from '../services/contractApi.js';
import { fetchAllStaff } from '../services/staffService.js';

// 契約書管理。雛形はaccount-sales-boardの契約書管理で登録したものをそのまま使う
// （両方のアプリで同じ雛形を使うので、雛形の登録・版の追加・入力項目・{{項目名}}のマーク付けは
// account-sales-board側だけで行う。こちらにも同じ編集画面を持つと、直しが片方にしか入らない）。
// この画面にあるのは、vol3だけの共通設定と、使える雛形の一覧（読み取りのみ）。
const ACCOUNT_SALES_BOARD_CONTRACTS_URL = 'https://account-sales-board.web.app/settings/contracts';

export default function ContractsSettingsPage() {
  const [contracts, setContracts] = useState(null);
  const [error, setError] = useState('');

  // vol3だけの共通設定。
  //  - Googleドキュメントを操作するアカウント: このアプリはGoogleでログインしないため、
  //    記入済み契約書の作成・修正などはここで選んだ社内アカウントとして行う
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
    setError('');
    api.listContracts().then(setContracts).catch((err) => setError(err.message));
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

  return (
    <PageWrap>
      <PageTitle>契約書管理</PageTitle>

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
              記入済み契約書の作成・修正と、締結済み契約書のアップロードは、このアカウントとして行います
              （作ったファイルの持ち主もこのアカウントになります）。記入済み契約書はaccount-sales-boardの雛形を
              複製して作るので、このアカウントがその雛形を開ける必要があります。担当者マスターでメールアドレスを登録した人から選べます。
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
        <SectionTitle>契約書の雛形（account-sales-boardと共通）</SectionTitle>
        <MetaLine style={{ marginBottom: 8 }}>
          雛形はaccount-sales-boardの契約書管理で登録したものを、そのまま使います。
          雛形の登録・新しい版の追加・種別・入力項目・{'{{項目名}}'}のマーク付けは、account-sales-boardで行ってください
          （直すと、こちらの締結依頼にもそのまま反映されます）。
        </MetaLine>
        <ActionGroup style={{ marginBottom: 12 }}>
          <Button as="a" href={ACCOUNT_SALES_BOARD_CONTRACTS_URL} target="_blank" rel="noopener noreferrer">
            account-sales-boardの契約書管理を開く
          </Button>
          <Button type="button" onClick={load}>読み直す</Button>
        </ActionGroup>
        {error && <FieldError>{error}</FieldError>}
        {contracts === null && !error && <EmptyNote>読み込み中...</EmptyNote>}
        {contracts !== null && groupRows.length === 0 && (
          <EmptyNote>account-sales-boardに契約書の雛形がまだ登録されていません</EmptyNote>
        )}
        {contracts !== null && groupRows.length > 0 && (
          <CardGrid>
            {groupRows.map(({ groupKey, name: label, list }) => {
              const current = list[0];
              return (
                <div key={groupKey} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    <Badge $bg={current.kind === 'basic' ? '#dbeafe' : '#f3f4f6'} $color={current.kind === 'basic' ? '#1e40af' : '#374151'}>
                      {current.kind === 'basic' ? '基本契約書' : '個別契約書'}
                    </Badge>
                    {current.isMarkupCopy && <Badge $bg="#dcfce7" $color="#166534">項目入り版</Badge>}
                    <MetaLine>v{current.version}・入力項目{(current.requestFields || []).length}件</MetaLine>
                  </div>
                  {(current.requestFields || []).length > 0 && (
                    <MetaLine style={{ marginTop: 4 }}>
                      {current.requestFields.map((f) => f.label).join('・')}
                    </MetaLine>
                  )}
                  <ActionGroup style={{ marginTop: 8 }}>
                    <Button as="a" href={current.url} target="_blank" rel="noopener noreferrer">雛形を開く</Button>
                    <Button
                      as="a"
                      href={`${ACCOUNT_SALES_BOARD_CONTRACTS_URL}/${encodeURIComponent(groupKey)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      account-sales-boardで編集
                    </Button>
                  </ActionGroup>
                </div>
              );
            })}
          </CardGrid>
        )}
      </Section>
    </PageWrap>
  );
}
