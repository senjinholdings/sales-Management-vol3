import React, { useState } from 'react';
import styled from 'styled-components';
import { FiCheck, FiRotateCcw } from 'react-icons/fi';
import { PROJECT_STAGES } from '../data/constants.js';
import { getStageState, getStageDef, getOverdueBusinessDays, formatStageDate } from '../utils/stageProgress.js';
import { completeStage, undoStage, fetchProjectById } from '../services/projectService.js';

// 矢羽根の切り込み深さ(px)
const ARROW_DEPTH = 12;

const Container = styled.div`
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
  background: #fafbfc;
`;

const SectionLabel = styled.div`
  font-size: 0.75rem;
  font-weight: 600;
  color: #666;
  margin-bottom: 0.75rem;
`;

/* パネル幅に収まらない場合は横スクロール */
const ScrollArea = styled.div`
  overflow-x: auto;
  padding-bottom: 0.25rem;
`;

const ChevronRow = styled.div`
  display: flex;
  align-items: flex-start;
  min-width: fit-content;
`;

const StageCol = styled.div`
  flex: 1 1 0;
  min-width: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;

  &:not(:first-child) {
    margin-left: -${ARROW_DEPTH - 2}px;
  }
`;

/* 右向きの矢羽根（シェブロン）。先頭以外は左側にも切り込みを入れて連結する */
const Chevron = styled.div`
  width: 100%;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0 ${ARROW_DEPTH + 4}px 0 ${props => props.$first ? '8px' : `${ARROW_DEPTH + 4}px`};
  clip-path: ${props => props.$first
    ? `polygon(0 0, calc(100% - ${ARROW_DEPTH}px) 0, 100% 50%, calc(100% - ${ARROW_DEPTH}px) 100%, 0 100%)`
    : `polygon(0 0, calc(100% - ${ARROW_DEPTH}px) 0, 100% 50%, calc(100% - ${ARROW_DEPTH}px) 100%, 0 100%, ${ARROW_DEPTH}px 50%)`};
  font-size: 0.68rem;
  line-height: 1.25;
  text-align: center;
  box-sizing: border-box;
  ${props => props.$state === 'done' ? `
    background: #d4edda;
    color: #1e7e34;
  ` : props.$state === 'current' ? `
    background: #27ae60;
    color: white;
    font-weight: 600;
  ` : `
    background: #f1f3f5;
    color: #999;
  `}
`;

const ChevronText = styled.span`
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const StepDate = styled.div`
  font-size: 0.65rem;
  color: #27ae60;
`;

const DeadlineText = styled.div`
  font-size: 0.7rem;
  color: #666;
`;

const DoneButton = styled.button`
  padding: 0.25rem 0.75rem;
  border: none;
  border-radius: 4px;
  background: #3498db;
  color: white;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  &:hover { background: #2980b9; }
  &:disabled { background: #bbb; cursor: not-allowed; }
`;

const UndoButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  color: #999;
  cursor: pointer;
  font-size: 0.65rem;
  &:hover { color: #e74c3c; border-color: #e74c3c; }
  &:disabled { cursor: not-allowed; opacity: 0.5; }
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
  font-size: 0.8rem;
  color: #666;
`;

const OverdueBadge = styled.span`
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  background: #e74c3c;
  color: white;
  font-size: 0.7rem;
  font-weight: 600;
`;

const CompletedBadge = styled.span`
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  background: #27ae60;
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
`;

/**
 * 受注後の進行ステージ表示（運用管理の案件パネル上部）
 * 完了日時はDoneボタン押下時のserverTimestampのみ。直接編集は不可
 */
const StageProgressBar = ({ project, onProjectUpdate }) => {
  const [stageProgress, setStageProgress] = useState(project.stageProgress || null);
  const [saving, setSaving] = useState(false);

  const state = getStageState(stageProgress);
  const { isStarted, currentStage, completedAt, allDone, deadline, undoableStage } = state;
  const overdueDays = getOverdueBusinessDays(deadline);

  // 保存後にドキュメントを再取得してserverTimestamp確定値を反映
  const refresh = async () => {
    const fresh = await fetchProjectById(project.id);
    const next = fresh?.stageProgress || null;
    setStageProgress(next);
    if (onProjectUpdate) {
      onProjectUpdate({ ...project, stageProgress: next });
    }
  };

  const handleDone = async () => {
    if (saving) return;
    try {
      setSaving(true);
      await completeStage(project.id, currentStage);
      await refresh();
    } catch (error) {
      console.error('ステージ完了の記録に失敗:', error);
      alert('ステージ完了の記録に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = async () => {
    if (saving || !undoableStage) return;
    const def = getStageDef(undoableStage);
    if (!window.confirm(`「${def?.name}」の完了を取り消しますか？`)) return;
    try {
      setSaving(true);
      await undoStage(project.id, undoableStage);
      await refresh();
    } catch (error) {
      console.error('ステージ取り消しに失敗:', error);
      alert('ステージ取り消しに失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container>
      <SectionLabel>受注後の進行ステージ</SectionLabel>
      <ScrollArea>
        <ChevronRow>
          {PROJECT_STAGES.map(stage => {
            const isDone = !!completedAt[stage.no];
            const isCurrent = !allDone && stage.no === currentStage;
            const stepState = isDone ? 'done' : isCurrent ? 'current' : 'future';
            return (
              <StageCol key={stage.no}>
                <Chevron $state={stepState} $first={stage.no === 1}>
                  {isDone && <FiCheck size={11} style={{ flexShrink: 0 }} />}
                  <ChevronText>{stage.name}</ChevronText>
                </Chevron>

                {/* 完了済み: 完了日 / 現在: Doneボタン+期限・超過 / 直前完了分: 取消 */}
                {isDone && <StepDate>{formatStageDate(completedAt[stage.no])} 完了</StepDate>}
                {isCurrent && (
                  <>
                    <DoneButton onClick={handleDone} disabled={saving}>Done</DoneButton>
                    {deadline && <DeadlineText>期限 {formatStageDate(deadline)}</DeadlineText>}
                    {overdueDays > 0 && <OverdueBadge>{overdueDays}日超過</OverdueBadge>}
                  </>
                )}
                {stage.no === undoableStage && (
                  <UndoButton onClick={handleUndo} disabled={saving}>
                    <FiRotateCcw size={10} />
                    取消
                  </UndoButton>
                )}
              </StageCol>
            );
          })}
        </ChevronRow>
      </ScrollArea>
      {(allDone || !isStarted) && (
        <StatusRow>
          {allDone ? (
            <CompletedBadge>全ステージ完了（プロジェクト開始済み）</CompletedBadge>
          ) : (
            <span>ステージ未開始 — 「契約締結」のDoneで進行管理を開始します</span>
          )}
        </StatusRow>
      )}
    </Container>
  );
};

export default StageProgressBar;
