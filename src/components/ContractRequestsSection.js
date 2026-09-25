import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, ActionGroup, EmptyNote, MetaLine, FormGrid, FormField, Label, Select, TextArea, FieldError, Input,
} from './contractUi.js';
import { toDate, formatDateTime } from '../utils/contractDates.js';
import { api } from '../services/contractApi.js';
import { fetchClientMeetingSettings } from '../services/projectService.js';
import ContractDocumentRevision from './ContractDocumentRevision.js';
import { readFileAsBase64 } from '../utils/readFileAsBase64.js';

// 案件の契約書（締結依頼のフォーム・プレビュー・一覧・状態更新・締結済みのアップロード・記入済み契約書）。
// account-sales-board(src/components/ContractRequestsSection.js)をそのまま移したもので、
// 手順・文言はあちらに揃えてある。違うのは次の点だけ:
//  - 案件に担当者(連絡先)の一覧が無いため、メールで共有するときの宛先はこのフォームで入力する
//  - Chatworkルーム・Slackチャンネルは会社単位のMTG設定(clientMeetingSettings)から読む
//  - 依頼フォームを開ける場所を呼び出し側で決める(allowRequest)。受注時と第一想起③の2か所から開く
//  - 依頼を送った・締結済みにしたことを呼び出し側に知らせる(onRequested/onSigned)。
//    第一想起の③の状態や、進行ステージの「契約締結」を進めるのに使う
const CONTRACT_REQUEST_STATUS_LABELS = { requested: '依頼中', signed: '締結済み', cancelled: '取り下げ' };
const CONTRACT_REQUEST_STATUS_COLORS = { requested: '#fef3c7', signed: '#dcfce7', cancelled: '#f3f4f6' };
const CONTRACT_REQUEST_STATUS_TEXT_COLORS = { requested: '#92400e', signed: '#166534', cancelled: '#6b7280' };
const SHARE_CHANNEL_LABELS = { email: 'メール', chatwork: 'Chatwork', slack: 'Slack' };
// 依頼文に載せる所属部署。契約書チームが振り分けに使う。
const DEPARTMENTS = ['営業', 'メディア', '広告'];

const entityLabel = 'この案件';

// 既に締結済みの契約書を、ファイルをアップロードして登録する。
//
// 今後の締結はこのアプリから依頼する前提だが、それ以前の契約書が既に何通もある。
// また、先方から修正依頼が来て直した版を受け取ることは今後も起きるので、
// 既にある締結記録に「修正版」として足せるようにしてある（差し替えではなく版を積む
// ―― どの版で合意したのかが後から分からなくなるのが一番まずい）。
function SignedContractUpload({ entityId, requests, onUploaded }) {
  const [open, setOpen] = useState(false);
  const [contractName, setContractName] = useState('');
  const [contractKind, setContractKind] = useState('individual');
  const [signedDate, setSignedDate] = useState('');
  const [note, setNote] = useState('');
  const [replacesRequestId, setReplacesRequestId] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const uploaded = (requests || []).filter((r) => r.status !== 'cancelled');
  const replacing = uploaded.find((r) => r.id === replacesRequestId);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) { setError('ファイルを選んでください'); return; }
    if (!replacesRequestId && !contractName.trim()) { setError('契約書名を入力してください'); return; }
    setBusy(true);
    setError('');
    try {
      await api.uploadSignedContract(entityId, {
        contractName: (replacing ? replacing.contractName : contractName).trim(),
        kind: contractKind,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileDataBase64: await readFileAsBase64(file),
        signedDate: signedDate || undefined,
        note: note.trim() || undefined,
        replacesRequestId: replacesRequestId || undefined,
      });
      setOpen(false);
      setContractName('');
      setNote('');
      setSignedDate('');
      setReplacesRequestId('');
      setFile(null);
      onUploaded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button type="button" style={{ marginBottom: 12 }} onClick={() => { setOpen(true); setError(''); }}>
        締結済みの契約書をアップロード
      </Button>
    );
  }

  return (
    <form onSubmit={handleUpload} style={{ marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
      <Label>締結済みの契約書をアップロード</Label>
      <MetaLine style={{ marginBottom: 8 }}>
        このアプリを通さずに締結した契約書を、{entityLabel}の締結記録として残します。
        先方の修正が入った版を受け取ったときは、下で元の契約書を選ぶと修正版として積まれます。
      </MetaLine>
      <FormGrid>
        <FormField>
          <Label>どの契約書か</Label>
          <Select value={replacesRequestId} onChange={(e) => setReplacesRequestId(e.target.value)}>
            <option value="">新しく登録する</option>
            {uploaded.map((r) => (
              <option key={r.id} value={r.id}>{r.contractName} の修正版として足す</option>
            ))}
          </Select>
        </FormField>
        {!replacesRequestId && (
          <>
            <FormField>
              <Label>契約書名（必須）</Label>
              <Input value={contractName} onChange={(e) => setContractName(e.target.value)} placeholder="例: 業務委託基本契約書" />
            </FormField>
            <FormField>
              <Label>種類</Label>
              <Select value={contractKind} onChange={(e) => setContractKind(e.target.value)}>
                <option value="individual">個別契約書</option>
                <option value="basic">基本契約書</option>
              </Select>
              <MetaLine style={{ marginTop: 2 }}>
                基本契約書にすると、個別契約書を依頼するときの「基本契約書の締結記録」として扱われます。
              </MetaLine>
            </FormField>
          </>
        )}
        <FormField>
          <Label>締結日（任意）</Label>
          <Input type="date" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
        </FormField>
        <FormField>
          <Label>ファイル（必須・8MBまで）</Label>
          <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <MetaLine style={{ marginTop: 2 }}>
            PDFはそのまま、Word（.docx）はGoogleドキュメントに変換して保存します。
          </MetaLine>
        </FormField>
        <FormField>
          <Label>メモ（任意）</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 支払条件を月末締め翌月末払いに修正した版" />
        </FormField>
      </FormGrid>
      {error && <FieldError>{error}</FieldError>}
      <ActionGroup style={{ marginTop: 10 }}>
        <Button type="submit" $variant="primary" disabled={busy}>{busy ? '登録中...' : '登録する'}</Button>
        <Button type="button" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>やめる</Button>
      </ActionGroup>
    </form>
  );
}

const list = api.listDealContractRequests;
const create = api.createDealContractRequest;
const preview = api.previewDealContractRequest;
const update = api.updateDealContractRequest;
const generateDocuments = api.generateDealContractDocuments;
const listDocuments = api.listDealContractDocuments;

/**
 * @param {object} props
 * @param {object} props.deal - 案件（progressDashboardのドキュメント。id・companyNameを使う）
 * @param {boolean} [props.allowRequest=true] - 「＋契約締結を依頼する」を出すか
 * @param {boolean} [props.startWithForm=false] - 開いた時点で依頼フォームを開いておくか
 * @param {Object<string,string>} [props.prefillByLabel] - 入力項目の初期値（項目名→値）。空欄の項目にだけ入れる
 * @param {Function} [props.onRequested] - 締結依頼を送ったあとに呼ぶ
 * @param {Function} [props.onSigned] - 締結済みになったあとに呼ぶ（締結済みにする・締結済みのアップロード）
 */
export default function ContractRequestsSection({
  deal, allowRequest = true, startWithForm = false, prefillByLabel, onRequested, onSigned,
}) {
  const entityId = deal.id;

  // Chatworkルーム・Slackチャンネルは会社単位のMTG設定にある。
  const [chatSettings, setChatSettings] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchClientMeetingSettings(deal.companyName)
      .then((settings) => { if (!cancelled) setChatSettings(settings || {}); })
      .catch(() => { if (!cancelled) setChatSettings({}); });
    return () => { cancelled = true; };
  }, [deal.companyName]);
  const entity = {
    chatworkRoomId: chatSettings?.chatworkRoomId || null,
    slackChannelId: chatSettings?.slackChannelId || null,
  };

  const [requests, setRequests] = useState(null);
  const [listError, setListError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

  const [contracts, setContracts] = useState(null);
  const [contractsError, setContractsError] = useState('');
  const [adding, setAdding] = useState(startWithForm);

  // 締結依頼で送るものの選び方。
  //  existing: すでに作ってある記入済み契約書を選ぶ（作り直さない）
  //  new:      雛形を選ぶ（項目を差し込んで新しく作る／雛形をそのまま送る）
  // 入力項目は「記入済み契約書を作るため」のものなので、existing では出さない。
  const [source, setSource] = useState('new');
  // existing で選んだ記入済み契約書のid。
  const [pickedDocumentIds, setPickedDocumentIds] = useState([]);
  const [contractId, setContractId] = useState('');
  // 基本契約書を選んだ時だけ使う、併せて締結する個別契約書(任意)。'' は「（なし）」。
  const [individualContractId, setIndividualContractId] = useState('');
  // 契約書ごとの入力項目(requestFields)の入力値。キーは`${contractId}:${fieldId}`。
  // 案件・パートナーどちらの契約書にも同じ形で使う。
  const [fieldValueMap, setFieldValueMap] = useState({});
  // 共有先はメールが既定（宛先はこのフォームで入力するので、常に選べる）。
  const [shareChannel, setShareChannel] = useState('email');
  // メールで共有するときの先方の担当者。案件に連絡先の一覧が無いため、ここで入力する。
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  // クラウドサイン送付先。空のままなら担当者のメールアドレスと同じにする。
  const [cloudSignEmail, setCloudSignEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  // テストグループに送るかどうか。既定は常にfalse(本番)で、テスト送信はこのチェックボックスで
  // 依頼ごとに明示的に選ぶ。以前は設定画面のトグルを初期値として読み込んでいたが、その設定画面を
  // 畳んだため(依頼ごとに選べれば十分という判断)、既定を本番に固定した。既定をテストにしておくと、
  // 切り替える場所が無いまま全ての依頼がテストへ飛び続けることになる。
  const [sendToTestChannel, setSendToTestChannel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // 送信前の確認画面用。雛形確認依頼(TemplateRequestForm)と同じ考え方で、
  // 確認画面の間はフォーム項目を隠し、条件を変えたければ一旦戻って(プレビュー破棄)選び直す。
  // 送る前に作る「記入済み契約書」。入力内容を変えたら作り直しになるので、
  // 変更を検知したら破棄する(古い値の入った契約書のリンクを送ってしまわないため)。
  // この場で入力項目そのものを足すためのもの。契約書の設定(requestFields)を更新するので、
  // 以降の依頼にもその項目が出る。設定画面へ行き来せずに済ませたい、という運用のため。
  const [presets, setPresets] = useState([]);
  const [newFieldFor, setNewFieldFor] = useState(null); // 追加フォームを開いている契約書のid
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldRequired, setNewFieldRequired] = useState(true);
  const [addingField, setAddingField] = useState(false);
  const [addFieldError, setAddFieldError] = useState('');

  const [generatedDocs, setGeneratedDocs] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  // この案件/パートナーでこれまでに作った記入済み契約書(契約書タブに出す)。
  const [documents, setDocuments] = useState(null);
  // 「文章を直す」で開いている記入済み契約書（AI修正・手直し・全体差分のパネル）。
  const [revisingDocument, setRevisingDocument] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewText, setPreviewText] = useState('');
  // テストグループ運用中(functions/README.md参照)は、プレビュー確認画面で
  // どこに送られるかを分かるように警告表示する。本番宛の場合はnull。
  const [testChannel, setTestChannel] = useState(null);

  const chatworkDisabled = !entity.chatworkRoomId;
  const slackDisabled = !entity.slackChannelId;


  const loadRequests = useCallback(() => {
    list(entityId).then(setRequests).catch((err) => setListError(err.message));
  }, [entityId]);

  const loadDocuments = useCallback(() => {
    listDocuments(entityId).then(setDocuments).catch(() => setDocuments([]));
  }, [entityId]);

  useEffect(() => { loadRequests(); }, [loadRequests]);
  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const loadContracts = useCallback(() => {
    api.listContracts().then(setContracts).catch((err) => setContractsError(err.message));
  }, []);

  useEffect(() => { loadContracts(); }, [loadContracts]);

  // 入力項目名のマスタ。ここで項目を足すときの候補として出す
  // (設定画面で登録した項目名と表記がぶれないようにするため)。
  useEffect(() => {
    api.listContractFieldPresets().then(setPresets).catch(() => setPresets([]));
  }, []);

  // 契約書名(groupKey)ごとにversionが最大のものだけを選択肢にする(過去の版を誤って選ばせないため)。
  const latestContracts = useMemo(() => {
    if (!contracts) return [];
    const byGroup = new Map();
    contracts.forEach((c) => {
      const current = byGroup.get(c.groupKey);
      if (!current || c.version > current.version) byGroup.set(c.groupKey, c);
    });
    return Array.from(byGroup.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }, [contracts]);

  useEffect(() => {
    if (!contractId && latestContracts.length > 0) setContractId(latestContracts[0].id);
  }, [latestContracts, contractId]);

  const selectedContract = latestContracts.find((c) => c.id === contractId) || null;
  // kindが無い契約書は個別契約書として扱う(古いデータが黙って基本契約書にならないようにするため)。
  // 基本契約書を選んだ時だけ、併せて選ぶ個別契約書の一覧を出す。
  const isBasicSelected = selectedContract?.kind === 'basic';
  const individualContractOptions = useMemo(
    () => latestContracts.filter((c) => c.kind !== 'basic'),
    [latestContracts],
  );
  const selectedIndividualContract = isBasicSelected
    ? individualContractOptions.find((c) => c.id === individualContractId) || null
    : null;

  // 入力項目の初期値（第一想起のヒアリング内容など）。まだ何も入れていない欄にだけ入れる
  // （入力途中の値を上書きしない）。
  useEffect(() => {
    if (!prefillByLabel) return;
    const additions = {};
    [selectedContract, selectedIndividualContract].filter(Boolean).forEach((c) => {
      (c.requestFields || []).forEach((f) => {
        const key = `${c.id}:${f.id}`;
        const value = prefillByLabel[f.label];
        if (value && fieldValueMap[key] === undefined) additions[key] = String(value);
      });
    });
    if (Object.keys(additions).length > 0) {
      setFieldValueMap((prev) => ({ ...additions, ...prev }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillByLabel, contractId, individualContractId, contracts]);

  // 主契約書が基本契約書でなくなったら(選び直したら)、個別契約書の選択も一緒に外す
  // (基本契約書でない時に個別契約書のidだけ残ると、送信データと画面表示が食い違うため)。
  useEffect(() => {
    if (!isBasicSelected && individualContractId) setIndividualContractId('');
  }, [isBasicSelected, individualContractId]);

  // 契約書の選択や入力値を変えたら、先に作ってある記入済み契約書は中身が古くなる。
  // そのまま依頼文に載せると「プレビューで見た内容と実物が違う」ことになるので破棄する。
  useEffect(() => {
    setGeneratedDocs([]);
    setGenerateError('');
  }, [contractId, individualContractId, fieldValueMap]);

  const fieldValueKey = (targetContractId, fieldId) => `${targetContractId}:${fieldId}`;

  // 入力欄を出す対象の契約書(主契約書→個別契約書の順)。両方とも入力項目が無ければ
  // 空配列になり、これまで通り追加の入力欄は何も出ない。
  const fieldSourceContracts = [selectedContract, selectedIndividualContract].filter(Boolean);

  const buildFieldValues = () => {
    const values = [];
    fieldSourceContracts.forEach((c) => {
      (c.requestFields || []).forEach((f) => {
        values.push({ contractId: c.id, fieldId: f.id, value: fieldValueMap[fieldValueKey(c.id, f.id)] || '' });
      });
    });
    return values;
  };

  // 作成済みの契約書を選んだとき、その契約書がどの雛形から作られたか。
  // 画面が知っているなら一緒に送る（サーバー側の引き当てだけに頼らない）。
  // 記録が無い古いデータのために、契約書名からの引き当ても用意しておく。
  // 契約書名は変更できるので、過去の名前(pastNames)も見る ―― 今の名前だけで探すと、
  // 名前を変えた時点で古い記録の引き当てが黙って切れる。
  const pickedContractId = (() => {
    const picked = (documents || []).filter((d) => pickedDocumentIds.includes(d.id));
    const withContract = picked.find((d) => d.contractId);
    if (withContract) return withContract.contractId;
    const matchesName = (c, name) => c.name === name || (c.pastNames || []).includes(name);
    const byName = picked
      .map((d) => latestContracts.find((c) => matchesName(c, d.contractName)))
      .find(Boolean);
    return byName ? byName.id : '';
  })();

  // 基本契約書を締結していないのに個別契約書を出そうとしていないか。
  //
  // 個別契約書は基本契約書があって初めて意味を持つので、順番が逆になると
  // 法務で差し戻しになる。送れなくはせず、送る前に気づけるように警告だけ出す
  // （基本契約書をこのアプリを通さずに締結しているケースもあるため、
  //  「記録が見つからない」という言い方にしてある）。
  //
  // 基本契約書を個別契約書と一緒に送る依頼(individualContract付き)なら、
  // その場で基本契約書も締結されるので警告は出さない。
  const contractKindById = useMemo(() => {
    const map = new Map();
    (contracts || []).forEach((c) => map.set(c.id, c.kind === 'basic' ? 'basic' : 'individual'));
    return map;
  }, [contracts]);

  const hasSignedBasicContract = (requests || []).some(
    (r) => r.status === 'signed' && contractKindById.get(r.contractId) === 'basic',
  );
  // これから送る契約書。雛形から送るときはその雛形、作成済みを選んだときはその出どころ。
  const sendingContractId = source === 'existing' ? pickedContractId : contractId;
  const sendingIndividualOnly = !!sendingContractId
    && contractKindById.get(sendingContractId) === 'individual';
  const showBasicContractWarning = sendingIndividualOnly && !hasSignedBasicContract;

  const buildRequestData = () => ({
    ...(source === 'existing'
      ? { generatedDocumentIds: pickedDocumentIds, contractId: pickedContractId || undefined }
      : {
        contractId,
        individualContractId: isBasicSelected && individualContractId ? individualContractId : undefined,
        fieldValues: buildFieldValues(),
        generatedDocumentIds: generatedDocs.map((d) => d.id),
      }),
    shareChannel,
    contactName: shareChannel === 'email' ? contactName.trim() : undefined,
    contactEmail: shareChannel === 'email' ? contactEmail.trim() : undefined,
    cloudSignEmail: shareChannel === 'email' ? (cloudSignEmail.trim() || contactEmail.trim()) : undefined,
    notes: notes.trim() || undefined,
    department,
    sendToTestChannel,
  });

  const openAddField = (contractId) => {
    setNewFieldFor(contractId);
    setNewFieldLabel('');
    setNewFieldRequired(true);
    setAddFieldError('');
  };

  // 契約書の入力項目(requestFields)に1つ足す。雛形の{{項目名}}と対応させたい場合は
  // 設定の契約書詳細でマーク付けする必要があるが、依頼文に1行足したいだけなら
  // ここで足すだけで足りる。
  const handleAddField = async (contract) => {
    const label = newFieldLabel.trim();
    if (!label) {
      setAddFieldError('項目名を入力してください');
      return;
    }
    if ((contract.requestFields || []).some((f) => f.label === label)) {
      setAddFieldError('同じ名前の項目がすでにあります');
      return;
    }
    setAddingField(true);
    setAddFieldError('');
    try {
      await api.updateContract(contract.id, {
        requestFields: [
          ...(contract.requestFields || []).map((f) => ({ id: f.id, label: f.label, required: f.required !== false })),
          { label, required: newFieldRequired },
        ],
      });
      setNewFieldFor(null);
      setNewFieldLabel('');
      loadContracts();
    } catch (err) {
      setAddFieldError(err.message);
    } finally {
      setAddingField(false);
    }
  };

  const handleGenerateDocuments = async () => {
    if (!contractId) {
      setGenerateError('契約書を選択してください');
      return;
    }
    setGenerating(true);
    setGenerateError('');
    try {
      const created = await generateDocuments(entityId, {
        contractId,
        individualContractId: isBasicSelected && individualContractId ? individualContractId : undefined,
        fieldValues: buildFieldValues(),
      });
      setGeneratedDocs(created);
      loadDocuments();
    } catch (err) {
      setGenerateError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handlePreview = async () => {
    if (source === 'existing' && pickedDocumentIds.length === 0) {
      setSubmitError('送る契約書を選んでください');
      return;
    }
    if (source === 'new' && !contractId) {
      setSubmitError('雛形を選択してください');
      return;
    }
    if (shareChannel === 'email' && (!contactName.trim() || !contactEmail.trim())) {
      setSubmitError('先方の担当者名とメールアドレスを入力してください');
      return;
    }
    setPreviewing(true);
    setSubmitError('');
    try {
      const { message, testChannel: previewTestChannel } = await preview(entityId, buildRequestData());
      setPreviewText(message);
      setTestChannel(previewTestChannel || null);
      setShowPreview(true);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleBackToForm = () => {
    setShowPreview(false);
    setPreviewText('');
    setTestChannel(null);
    setSubmitError('');
  };

  const handleSend = async () => {
    if (source === 'existing' && pickedDocumentIds.length === 0) {
      setSubmitError('送る契約書を選んでください');
      return;
    }
    if (source === 'new' && !contractId) {
      setSubmitError('雛形を選択してください');
      return;
    }
    setBusy(true);
    setSubmitError('');
    try {
      await create(entityId, {
        ...buildRequestData(),
        messageOverride: previewText,
      });
      setNotes('');
      setIndividualContractId('');
      setFieldValueMap({});
      setGeneratedDocs([]);
      setPickedDocumentIds([]);
      setAdding(false);
      setShowPreview(false);
      setTestChannel(null);
      loadRequests();
      if (onRequested) await onRequested();
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateStatus = async (requestId, status) => {
    setUpdatingId(requestId);
    setListError('');
    try {
      await update(entityId, requestId, { status });
      loadRequests();
      if (status === 'signed' && onSigned) await onSigned();
    } catch (err) {
      setListError(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div>
      <SignedContractUpload
        entityId={entityId}
        requests={requests}
        onUploaded={async () => {
          loadRequests();
          // アップロードした契約書は締結済みとして登録される（修正版を足した場合も締結済みになる）。
          if (onSigned) await onSigned();
        }}
      />
      {listError && <FieldError>{listError}</FieldError>}
      {requests === null && <EmptyNote>読み込み中...</EmptyNote>}
      {requests !== null && requests.length === 0 && <EmptyNote>契約締結の依頼はまだありません</EmptyNote>}
      {requests !== null && requests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {requests.map((r) => (
            <div key={r.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <a href={r.contractUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, fontSize: 13 }}>
                  {r.contractName}{r.contractVersion ? `（第${r.contractVersion}版）` : ''}
                </a>
                {r.source === 'upload' && <Badge $bg="#f3f4f6" $color="#4b5563">アップロードして登録</Badge>}
                <Badge
                  $bg={CONTRACT_REQUEST_STATUS_COLORS[r.status] || '#f3f4f6'}
                  $color={CONTRACT_REQUEST_STATUS_TEXT_COLORS[r.status] || '#6b7280'}
                >
                  {CONTRACT_REQUEST_STATUS_LABELS[r.status] || r.status}
                </Badge>
              </div>
              {r.individualContract && (
                <MetaLine style={{ marginTop: 4 }}>
                  個別契約書：
                  <a href={r.individualContract.url} target="_blank" rel="noopener noreferrer">
                    {r.individualContract.name}（第{r.individualContract.version}版）
                  </a>
                </MetaLine>
              )}
              <MetaLine style={{ marginTop: 4 }}>
                共有先：{SHARE_CHANNEL_LABELS[r.shareChannel] || r.shareChannel}
                {r.emailContact ? `（${r.emailContact.name} <${r.emailContact.email}>）` : ''}
                　・　依頼日時：{formatDateTime(toDate(r.requestedAt))}
                {r.requestedBy ? `　・　依頼者：${r.requestedBy}` : ''}
              </MetaLine>
              {(r.fieldValues || []).map((fv) => (
                <MetaLine key={fv.label}>{fv.label}：{fv.value}</MetaLine>
              ))}
              {(r.generatedDocuments || []).map((d) => (
                <MetaLine key={d.id} style={{ wordBreak: 'break-all' }}>
                  記入済み契約書：<a href={d.url} target="_blank" rel="noopener noreferrer">{d.name}</a>
                </MetaLine>
              ))}
              {(r.uploadedVersions || []).map((v, i) => (
                // 差し替えではなく版を積む。どの版で合意したのかが後から分からなくなるのが一番まずい。
                // eslint-disable-next-line react/no-array-index-key
                <MetaLine key={i} style={{ wordBreak: 'break-all' }}>
                  {i === 0 ? '登録したファイル' : `修正版${i}`}：
                  <a href={v.url} target="_blank" rel="noopener noreferrer">{v.fileName}</a>
                  {v.uploadedAt ? `（${formatDateTime(toDate(v.uploadedAt))}）` : ''}
                  {v.note ? `　${v.note}` : ''}
                </MetaLine>
              ))}
              {r.notes && <MetaLine>備考：{r.notes}</MetaLine>}
              {r.status === 'requested' && (
                <ActionGroup style={{ marginTop: 8 }}>
                  <Button onClick={() => handleUpdateStatus(r.id, 'signed')} disabled={updatingId === r.id}>
                    {updatingId === r.id ? '更新中...' : '締結済みにする'}
                  </Button>
                  <Button $variant="danger" onClick={() => handleUpdateStatus(r.id, 'cancelled')} disabled={updatingId === r.id}>
                    {updatingId === r.id ? '更新中...' : '取り下げる'}
                  </Button>
                </ActionGroup>
              )}
            </div>
          ))}
        </div>
      )}

      {documents !== null && documents.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Label>作成した記入済み契約書</Label>
          {documents.map((d) => (
            <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 4, flexWrap: 'wrap' }}>
              <MetaLine style={{ wordBreak: 'break-all', flex: '1 1 240px' }}>
                <a href={d.url} target="_blank" rel="noopener noreferrer">{d.name}</a>
                （{d.contractName}{d.contractVersion ? `・第${d.contractVersion}版` : ''}
                {d.createdAt ? `・${formatDateTime(toDate(d.createdAt))}` : ''}）
                {/* 共有できていないことに気づかず依頼を送るのが一番まずいので、
                    失敗したときだけはっきり出す。 */}
                {d.sharingError
                  ? <span style={{ color: '#b91c1c' }}>　共有に失敗：{d.sharingError}（Googleドキュメントで法務に共有してください）</span>
                  : d.sharing === 'domain' ? '　社内全員が編集可'
                    : d.sharing === 'anyone' ? '　リンクを知っている全員が編集可' : ''}
              </MetaLine>
              {/* 案件ごとの事情に合わせた直しはここから。雛形ではなく、この案件用に
                  作ったファイルだけを直す（雛形を直すと他の案件にも漏れるため）。 */}
              <Button type="button" onClick={() => setRevisingDocument(d)}>文章を直す</Button>
            </div>
          ))}
        </div>
      )}

      {revisingDocument && (
        <ContractDocumentRevision
          kind="deal"
          entityId={entityId}
          document={revisingDocument}
          onSaved={loadDocuments}
          onClose={() => setRevisingDocument(null)}
        />
      )}

      {!adding ? (
        allowRequest
          ? <Button onClick={() => setAdding(true)}>＋契約締結を依頼する</Button>
          : (
            <MetaLine>
              締結依頼は「受注情報の入力」（フェーズ8にしたとき）か、第一想起の「契約締結依頼」ボタンから出せます。
            </MetaLine>
          )
      ) : (
        <div style={{ padding: '12px 0', borderTop: '1px solid #e5e7eb' }}>
          {contractsError && <FieldError>{contractsError}</FieldError>}
          {contracts !== null && latestContracts.length === 0 && !contractsError && (
            <EmptyNote>契約書が登録されていません。先にマスター管理 → 契約書管理で登録してください</EmptyNote>
          )}
          {latestContracts.length > 0 && !showPreview && (
            <>
              {/* 送るものは「すでに作ってある契約書」か「雛形」かのどちらか。
                  入力項目は記入済み契約書を作るためのものなので、
                  作ってあるものを送るだけなら入力は要らない。 */}
              <FormField>
                <Label>何を送るか</Label>
                <ActionGroup>
                  <Button
                    type="button"
                    $variant={source === 'existing' ? 'primary' : undefined}
                    onClick={() => setSource('existing')}
                  >
                    作成済みの契約書を送る
                  </Button>
                  <Button
                    type="button"
                    $variant={source === 'new' ? 'primary' : undefined}
                    onClick={() => setSource('new')}
                  >
                    雛形から作る／雛形を送る
                  </Button>
                </ActionGroup>
              </FormField>

              {source === 'existing' && (
                <FormField>
                  <Label>送る契約書</Label>
                  {(documents || []).length === 0
                    ? (
                      <EmptyNote>
                        作成済みの契約書がありません。「雛形から作る」を選んで、項目を入れた契約書を作ってください
                      </EmptyNote>
                    )
                    : (documents || []).map((d) => (
                      <label key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 6, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={pickedDocumentIds.includes(d.id)}
                          onChange={(e) => setPickedDocumentIds((prev) => (
                            e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id)
                          ))}
                        />
                        <span style={{ fontSize: 13, wordBreak: 'break-all' }}>
                          {d.name}
                          <MetaLine>
                            {d.contractName}{d.contractVersion ? `・第${d.contractVersion}版` : ''}
                            {d.createdAt ? `・${formatDateTime(toDate(d.createdAt))}` : ''}
                          </MetaLine>
                        </span>
                      </label>
                    ))}
                  <MetaLine style={{ marginTop: 6 }}>
                    「文章を直す」で手を入れたものも、ここから選べます。依頼文には元の雛形のリンクと、
                    その契約書を作ったときの入力値も載ります。契約相手には、入力項目の会社名
                    （契約相手・契約先・会社名・企業名のいずれか）があればそちらを使います。
                  </MetaLine>
                </FormField>
              )}

              {showBasicContractWarning && (
                <div style={{
                  marginBottom: 10, padding: 10, borderRadius: 6,
                  background: '#fef3c7', border: '1px solid #fcd34d',
                }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                    基本契約書の締結記録が見つかりません
                  </div>
                  <MetaLine style={{ marginTop: 2 }}>
                    これは個別契約書です。{entityLabel}には、締結済みの基本契約書がこのアプリ上にありません。
                    先に基本契約書を締結するか、基本契約書を選んで「個別契約書（任意）」で一緒に送ってください。
                    すでに別途締結済みであれば、そのまま進めて構いません。
                  </MetaLine>
                </div>
              )}

              <FormGrid>
                {source === 'new' && (
                <FormField>
                  <Label>雛形</Label>
                  <Select value={contractId} onChange={(e) => setContractId(e.target.value)}>
                    {latestContracts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}（第{c.version}版）</option>
                    ))}
                  </Select>
                </FormField>
                )}
                {source === 'new' && isBasicSelected && (
                  <FormField>
                    <Label>個別契約書（任意）</Label>
                    <Select value={individualContractId} onChange={(e) => setIndividualContractId(e.target.value)}>
                      <option value="">（なし）</option>
                      {individualContractOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}（第{c.version}版）</option>
                      ))}
                    </Select>
                    <MetaLine style={{ marginTop: 4 }}>
                      基本契約書と併せて締結する個別契約書があれば選んでください。1件の依頼としてまとめて送られます。
                    </MetaLine>
                  </FormField>
                )}
                <FormField>
                  <Label>共有先／グループ</Label>
                  <Select value={shareChannel} onChange={(e) => setShareChannel(e.target.value)}>
                    <option value="email">メール</option>
                    <option value="chatwork" disabled={chatworkDisabled}>Chatwork{chatworkDisabled ? `（${entityLabel}の会社にルーム未連携）` : ''}</option>
                    <option value="slack" disabled={slackDisabled}>Slack{slackDisabled ? `（${entityLabel}の会社にチャンネル未連携）` : ''}</option>
                  </Select>
                  {(chatworkDisabled || slackDisabled) && (
                    <MetaLine>
                      選べないものは、{entityLabel}の会社にルーム／チャンネルが紐づいていません。
                      案件詳細のMTG設定（Chatworkルーム・Slackチャンネル）で紐づけると選べるようになります。
                    </MetaLine>
                  )}
                </FormField>
                {shareChannel === 'email' && (
                  <>
                    <FormField>
                      <Label>先方の担当者名</Label>
                      <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="例: 山田 太郎" />
                    </FormField>
                    <FormField>
                      <Label>先方の担当者のメールアドレス</Label>
                      <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="例: yamada@example.com" />
                    </FormField>
                    <FormField>
                      <Label>クラウドサイン送付先</Label>
                      <Input
                        type="email"
                        value={cloudSignEmail}
                        onChange={(e) => setCloudSignEmail(e.target.value)}
                        placeholder={contactEmail.trim() || '空欄なら担当者のメールアドレスと同じ'}
                      />
                      <MetaLine style={{ marginTop: 2 }}>空欄なら担当者のメールアドレスと同じにします。</MetaLine>
                    </FormField>
                  </>
                )}
              </FormGrid>
              {source === 'new' && fieldSourceContracts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4, marginBottom: 4 }}>
                  <MetaLine>
                    入力項目は「記入済み契約書を作る」ために使います。雛形をそのまま送るだけなら、
                    空のままでも依頼は送れます（必須の印は作成するときだけ効きます）。
                  </MetaLine>
                  {fieldSourceContracts.map((c) => (
                    <div key={c.id}>
                      <MetaLine style={{ fontWeight: 600, color: '#374151' }}>{c.name}の入力項目</MetaLine>
                      <FormGrid style={{ marginTop: 6 }}>
                        {(c.requestFields || []).map((f) => {
                          const key = fieldValueKey(c.id, f.id);
                          const required = f.required !== false;
                          return (
                            <FormField key={f.id}>
                              <Label>{f.label}（{required ? '必須' : '任意'}）</Label>
                              <Input
                                value={fieldValueMap[key] || ''}
                                onChange={(e) => setFieldValueMap((prev) => ({ ...prev, [key]: e.target.value }))}
                              />
                            </FormField>
                          );
                        })}
                      </FormGrid>
                      {/* 依頼を書いている途中で「この項目も要る」と気づくことがあるので、
                          設定画面へ行かずにここで足せるようにする。足した項目は契約書の設定に
                          入るので、以降の依頼にも出る。 */}
                      {newFieldFor === c.id ? (
                        <div style={{ marginTop: 6, padding: 10, background: '#f9fafb', borderRadius: 8 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Input
                              value={newFieldLabel}
                              onChange={(e) => setNewFieldLabel(e.target.value)}
                              placeholder="項目名（例: 実施期間）"
                              list={`contract-field-presets-${c.id}`}
                              style={{ flex: '1 1 200px' }}
                            />
                            <datalist id={`contract-field-presets-${c.id}`}>
                              {presets.map((pre) => <option key={pre.id} value={pre.label} />)}
                            </datalist>
                            <Label style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 0, whiteSpace: 'nowrap' }}>
                              <input
                                type="checkbox"
                                checked={newFieldRequired}
                                onChange={(e) => setNewFieldRequired(e.target.checked)}
                              />
                              必須
                            </Label>
                            <Button type="button" $variant="primary" disabled={addingField} onClick={() => handleAddField(c)}>
                              {addingField ? '追加中...' : '追加'}
                            </Button>
                            <Button type="button" disabled={addingField} onClick={() => setNewFieldFor(null)}>キャンセル</Button>
                          </div>
                          <MetaLine style={{ marginTop: 4 }}>
                            この契約書の設定に追加されるので、次回以降の依頼にも出ます。
                          </MetaLine>
                          {addFieldError && <FieldError>{addFieldError}</FieldError>}
                        </div>
                      ) : (
                        <Button type="button" style={{ marginTop: 6 }} onClick={() => openAddField(c.id)}>
                          ＋入力項目を追加
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {source === 'new' && (
              <FormField>
                <Label>記入済み契約書（任意）</Label>
                <MetaLine>
                  上で入力した値を雛形の{'{{項目名}}'}に差し込んだ契約書を作ります。作ってから依頼すると、
                  依頼文に記入済み契約書のリンクが入ります。雛形は書き換わりません。
                  作ったファイルは、法務がそのまま開いて直せるように共有設定まで済ませます。
                </MetaLine>
                <ActionGroup style={{ marginTop: 6 }}>
                  <Button type="button" onClick={handleGenerateDocuments} disabled={generating}>
                    {generating ? '作成中...' : generatedDocs.length > 0 ? '作り直す' : '記入済み契約書を作成'}
                  </Button>
                </ActionGroup>
                {generatedDocs.map((d) => (
                  <MetaLine key={d.id} style={{ marginTop: 4, wordBreak: 'break-all' }}>
                    ✅ <a href={d.url} target="_blank" rel="noopener noreferrer">{d.name}</a>（{d.contractName}）
                    {d.sharingError
                      ? <span style={{ color: '#b91c1c' }}>　共有に失敗：{d.sharingError}</span>
                      : d.sharing === 'domain' ? '　社内全員が編集可'
                        : d.sharing === 'anyone' ? '　リンクを知っている全員が編集可' : ''}
                  </MetaLine>
                ))}
                {generateError && <FieldError>{generateError}</FieldError>}
              </FormField>
              )}
              <FormField>
                <Label>所属部署</Label>
                <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              </FormField>
              <FormField>
                <Label>備考（任意）</Label>
                <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="担当チームに伝えたい追加のメッセージがあれば入力してください" />
              </FormField>
              <FormField>
                <Label>
                  <input
                    type="checkbox"
                    checked={sendToTestChannel}
                    onChange={(e) => setSendToTestChannel(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  テストグループに送る（本番の依頼先には送りません）
                </Label>
                <MetaLine>動作確認のために送る場合はオンにしてください。オフなら本番の契約書チームに送られます。</MetaLine>
              </FormField>
            </>
          )}
          {latestContracts.length > 0 && showPreview && (
            <FormField>
              {testChannel && (
                <MetaLine style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 6 }}>
                  テストグループ（{testChannel.channelId}）に送信されます。本番の契約書チームには届きません
                </MetaLine>
              )}
              <Label>依頼文（この内容で送信されます。必要なら修正してください）</Label>
              <TextArea
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                style={{ minHeight: 220 }}
              />
            </FormField>
          )}
          <ActionGroup style={{ marginTop: 8 }}>
            {latestContracts.length > 0 && !showPreview && (
              <Button $variant="primary" onClick={handlePreview} disabled={previewing}>
                {previewing ? '確認中...' : '契約締結を依頼する'}
              </Button>
            )}
            {latestContracts.length > 0 && showPreview && (
              <>
                <Button $variant="primary" onClick={handleSend} disabled={busy}>
                  {busy ? '送信中...' : '送信する'}
                </Button>
                <Button onClick={handleBackToForm} disabled={busy}>戻る</Button>
              </>
            )}
            <Button onClick={() => { setAdding(false); handleBackToForm(); }} disabled={busy}>閉じる</Button>
          </ActionGroup>
          {submitError && <FieldError>{submitError}</FieldError>}
        </div>
      )}
    </div>
  );
}
