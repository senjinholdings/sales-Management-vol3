import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiCalendar, FiCheckCircle, FiCircle, FiEdit3, FiSave, FiX, FiRefreshCw, FiAlertCircle } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, query, where, getDocs, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { addBusinessDays } from '../utils/businessDays.js';

const PageContainer = styled.div`
  width: 100%;
  padding: 0 2rem;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
`;

const Title = styled.h2`
  color: #2c3e50;
  margin: 0;
`;

const RefreshButton = styled.button`
  background: #95a5a6;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  
  &:hover {
    background: #7f8c8d;
  }
`;

const InfoBox = styled.div`
  background: #e8f4f8;
  border: 1px solid #bee5eb;
  padding: 1rem;
  border-radius: 4px;
  margin-bottom: 2rem;
  color: #0c5460;
`;

const DealCard = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
`;

const DealHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #f8f9fa;
`;

const DealInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const DealName = styled.h3`
  margin: 0;
  color: #2c3e50;
`;

const DealMeta = styled.div`
  display: flex;
  gap: 1rem;
  font-size: 0.9rem;
  color: #7f8c8d;
`;

const EditButton = styled.button`
  background: #3498db;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  
  &:hover {
    background: #2980b9;
  }
`;

const TaskList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const TaskItem = styled.div`
  display: grid;
  grid-template-columns: 30px 1fr 150px 120px 30px;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: ${props => props.isOverdue ? '#fee' : '#f8f9fa'};
  border-radius: 4px;
  transition: all 0.2s ease;
  cursor: pointer;
  border: ${props => props.isOverdue ? '1px solid #fcc' : '1px solid transparent'};
  
  &:hover {
    background: ${props => props.isOverdue ? '#fdd' : '#e9ecef'};
  }
`;

const TaskStatus = styled.div`
  cursor: pointer;
  color: ${props => props.completed ? '#27ae60' : '#95a5a6'};
  display: flex;
  align-items: center;
  justify-content: center;
`;

const TaskName = styled.div`
  font-weight: 500;
  color: #2c3e50;
`;

const TaskDate = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #7f8c8d;
  font-size: 0.9rem;
`;

const TaskAction = styled.div`
  font-size: 0.85rem;
  color: ${props => props.completed ? '#27ae60' : '#e74c3c'};
  font-weight: 500;
`;

const WarningIcon = styled.div`
  color: #e74c3c;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const EditModal = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
`;

const ModalTitle = styled.h3`
  margin: 0;
  color: #2c3e50;
`;

const InfoText = styled.p`
  color: #7f8c8d;
  font-size: 0.9rem;
  margin: 0.5rem 0 1rem 0;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: #7f8c8d;
  cursor: pointer;
  padding: 0.25rem;
  
  &:hover {
    color: #2c3e50;
  }
`;

const FormGroup = styled.div`
  margin-bottom: 1rem;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 0.5rem;
  color: #2c3e50;
  font-weight: 500;
`;

const Input = styled.input`
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  
  &:focus {
    outline: none;
    border-color: #3498db;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
`;

const Button = styled.button`
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  
  &.primary {
    background: #27ae60;
    color: white;
    
    &:hover {
      background: #219a52;
    }
  }
  
  &.secondary {
    background: #95a5a6;
    color: white;
    
    &:hover {
      background: #7f8c8d;
    }
  }
`;

const AlertSection = styled.div`
  background: #fee;
  border: 2px solid #fcc;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 2rem;
`;

const AlertTitle = styled.h3`
  color: #e74c3c;
  margin: 0 0 1rem 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const AlertGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
`;

const AlertCard = styled.div`
  background: white;
  border: 1px solid #fcc;
  border-radius: 4px;
  padding: 1rem;
`;

const AlertDealName = styled.h4`
  color: #2c3e50;
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
`;

const AlertTaskName = styled.div`
  color: #e74c3c;
  font-weight: 500;
  margin-bottom: 0.25rem;
`;

const AlertDate = styled.div`
  color: #7f8c8d;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
`;

const DoneSection = styled.div`
  margin-top: 3rem;
`;

const SectionDivider = styled.div`
  height: 2px;
  background: #e9ecef;
  margin: 2rem 0;
`;

const SectionTitle = styled.h3`
  color: #7f8c8d;
  font-size: 1.2rem;
  margin: 0 0 1rem 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const DoneDealCard = styled(DealCard)`
  background: #f8f9fa;
  opacity: 0.9;
`;

const TaskProgressPage = () => {
  const [deals, setDeals] = useState([]);
  const [taskTemplates, setTaskTemplates] = useState({});
  const [loading, setLoading] = useState(true);
  const [editingDeal, setEditingDeal] = useState(null);
  const [receivedOrderDate, setReceivedOrderDate] = useState('');

  // タスクテンプレート定義
  const defaultTaskTemplate = [
    { name: '進行スケジュールの送付', daysFromOrder: 0 },
    { name: '会議・打ち合わせMTG', daysFromOrder: 7 },
    { name: 'レポーティングシートの提出', daysFromOrder: 7 },
    { name: 'レギュレーション確認動画の送付', daysFromOrder: 7 },
    { name: '完成動画10本送付', daysFromOrder: -3 }, // 開始3日前
    { name: '開始連絡', daysFromOrder: -1 }, // 開始前日
    { name: '配信開始', daysFromOrder: 0, isStartDate: true } // 開始日
  ];

  // 成約案件一覧から直接「第一想起取れるくん」の受注案件を取得
  const fetchDeals = async () => {
    setLoading(true);
    try {
      // 成約案件を直接取得
      const dealsRef = collection(db, 'progressDashboard');
      const q = query(
        dealsRef, 
        where('proposalMenu', '==', '第一想起取れるくん'),
        where('status', '==', 'フェーズ8')
      );
      const querySnapshot = await getDocs(q);
      
      const dealsList = [];
      querySnapshot.forEach((doc) => {
        dealsList.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      setDeals(dealsList);
      
      // タスクテンプレートを取得
      const templatesRef = collection(db, 'taskTemplates');
      const templatesSnapshot = await getDocs(templatesRef);
      const templates = {};
      
      templatesSnapshot.forEach((doc) => {
        templates[doc.data().dealId] = doc.data();
      });
      
      setTaskTemplates(templates);
    } catch (error) {
      console.error('案件取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  // タスクの完了状態を切り替え
  const toggleTaskStatus = async (dealId, taskIndex) => {
    const template = taskTemplates[dealId];
    if (!template) return;

    const updatedTasks = [...template.tasks];
    updatedTasks[taskIndex].completed = !updatedTasks[taskIndex].completed;
    updatedTasks[taskIndex].completedDate = updatedTasks[taskIndex].completed 
      ? new Date().toISOString() 
      : null;

    try {
      const docRef = doc(db, 'taskTemplates', template.id || dealId);
      await setDoc(docRef, {
        ...template,
        tasks: updatedTasks,
        updatedAt: serverTimestamp()
      }, { merge: true });

      setTaskTemplates(prev => ({
        ...prev,
        [dealId]: { ...template, tasks: updatedTasks }
      }));
    } catch (error) {
      console.error('タスク更新エラー:', error);
    }
  };

  // 開始予定日を更新
  const updateStartDate = async () => {
    if (!editingDeal || !receivedOrderDate) return;

    const deal = deals.find(d => d.id === editingDeal);
    if (!deal) return;

    // 成約案件一覧から確定日を取得するため、confirmedDateを使用
    const receivedDate = deal.confirmedDate || deal.createdAt?.toDate?.().toISOString().split('T')[0] || new Date().toISOString().split('T')[0];

    // タスクを計算
    const tasks = defaultTaskTemplate.map(taskTemplate => {
      let taskDate;
      if (taskTemplate.isStartDate) {
        // 開始日は入力された開始予定日を使用
        taskDate = new Date(receivedOrderDate);
      } else if (taskTemplate.daysFromOrder < 0) {
        // 開始日からの相対日付
        const startDate = new Date(receivedOrderDate);
        taskDate = addBusinessDays(startDate, taskTemplate.daysFromOrder);
      } else {
        // 受注日（確定日）からの相対日付
        taskDate = addBusinessDays(new Date(receivedDate), taskTemplate.daysFromOrder);
      }

      return {
        name: taskTemplate.name,
        daysFromOrder: taskTemplate.daysFromOrder,
        taskDate: taskDate.toISOString().split('T')[0],
        completed: false,
        completedDate: null
      };
    });

    try {
      const templateData = {
        dealId: deal.id,
        receivedOrderDate: receivedDate,
        startDate: receivedOrderDate,
        tasks: tasks,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const docRef = doc(db, 'taskTemplates', deal.id);
      await setDoc(docRef, templateData);

      setTaskTemplates(prev => ({
        ...prev,
        [deal.id]: { ...templateData, id: deal.id }
      }));

      setEditingDeal(null);
      setReceivedOrderDate('');
    } catch (error) {
      console.error('開始予定日更新エラー:', error);
    }
  };

  // 初期データ取得
  useEffect(() => {
    fetchDeals();
  }, []);

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  // 期限切れタスクを抽出
  const getOverdueTasks = () => {
    const overdueTasks = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    deals.forEach(deal => {
      const template = taskTemplates[deal.id];
      if (template && template.tasks) {
        template.tasks.forEach((task, index) => {
          const taskDate = new Date(task.taskDate);
          taskDate.setHours(0, 0, 0, 0);
          
          if (!task.completed && taskDate <= today) {
            overdueTasks.push({
              dealId: deal.id,
              dealName: deal.productName,
              taskName: task.name,
              taskDate: task.taskDate,
              taskIndex: index,
              daysOverdue: Math.floor((today - taskDate) / (1000 * 60 * 60 * 24))
            });
          }
        });
      }
    });

    // 期限切れ日数が多い順にソート
    return overdueTasks.sort((a, b) => b.daysOverdue - a.daysOverdue);
  };

  return (
    <PageContainer>
      <Header>
        <Title>タスク進行表（第一想起取れるくん）</Title>
        <RefreshButton onClick={fetchDeals}>
          <FiRefreshCw />
          更新
        </RefreshButton>
      </Header>

      <InfoBox>
        受注日（確定日）と開始予定日を起点として、各タスクの実施予定日が自動計算されます。
        営業日ベースで計算され、土日祝日は除外されます。
      </InfoBox>

      {loading ? (
        <div>読み込み中...</div>
      ) : deals.length === 0 ? (
        <DealCard>
          <p>成約案件（第一想起取れるくん）がありません。</p>
        </DealCard>
      ) : (
        <>
          {/* 期限切れタスクアラート */}
          {(() => {
            const overdueTasks = getOverdueTasks();
            if (overdueTasks.length > 0) {
              return (
                <AlertSection>
                  <AlertTitle>
                    <FiAlertCircle size={24} />
                    期限切れタスク（{overdueTasks.length}件）
                  </AlertTitle>
                  <AlertGrid>
                    {overdueTasks.map((task) => (
                      <AlertCard key={`${task.dealId}-${task.taskIndex}`}>
                        <AlertDealName>{task.dealName}</AlertDealName>
                        <AlertTaskName>{task.taskName}</AlertTaskName>
                        <AlertDate>
                          <FiCalendar size={14} />
                          {formatDate(task.taskDate)}
                          {task.daysOverdue > 0 && (
                            <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>
                              （{task.daysOverdue}日超過）
                            </span>
                          )}
                        </AlertDate>
                      </AlertCard>
                    ))}
                  </AlertGrid>
                </AlertSection>
              );
            }
            return null;
          })()}

          {/* 案件を分類して表示 */}
          {(() => {
            // 案件を受注日でソートしつつ、完了済みと未完了に分類
            const sortedDeals = [...deals].sort((a, b) => {
              // 受注日（confirmedDate）でソート、なければcreatedAtを使用
              const dateA = a.confirmedDate || a.createdAt?.toDate?.().toISOString() || '';
              const dateB = b.confirmedDate || b.createdAt?.toDate?.().toISOString() || '';
              return dateB.localeCompare(dateA); // 新しい順
            });

            // 全タスク完了済みの案件と未完了タスクがある案件を分離
            const incompleteDealsList = [];
            const completedDealsList = [];

            sortedDeals.forEach(deal => {
              const template = taskTemplates[deal.id];
              if (template && template.tasks) {
                const allCompleted = template.tasks.every(task => task.completed);
                if (allCompleted) {
                  completedDealsList.push(deal);
                } else {
                  incompleteDealsList.push(deal);
                }
              } else {
                // テンプレートがない案件は未完了扱い
                incompleteDealsList.push(deal);
              }
            });

            return (
              <>
                {/* 未完了タスクがある案件 */}
                {incompleteDealsList.map(deal => {
                  const template = taskTemplates[deal.id];
                  return (
                    <DealCard key={deal.id}>
                      <DealHeader>
                        <DealInfo>
                          <DealName>{deal.productName}</DealName>
                          <DealMeta>
                            <span>担当: {deal.representative}</span>
                            {template && (
                              <span>受注日: {formatDate(template.receivedOrderDate)}</span>
                            )}
                            <span>開始予定: {formatDate(deal.nextActionDate)}</span>
                          </DealMeta>
                        </DealInfo>
                        <EditButton onClick={() => {
                          setEditingDeal(deal.id);
                          setReceivedOrderDate(template?.startDate || '');
                        }}>
                          <FiEdit3 />
                          開始日変更
                        </EditButton>
                      </DealHeader>
                      
                      {template ? (
                        <TaskList>
                          {template.tasks.map((task, index) => {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const taskDate = new Date(task.taskDate);
                            taskDate.setHours(0, 0, 0, 0);
                            const isOverdue = !task.completed && taskDate < today;
                            
                            return (
                              <TaskItem 
                                key={index} 
                                onClick={() => toggleTaskStatus(deal.id, index)}
                                isOverdue={isOverdue}
                              >
                                <TaskStatus completed={task.completed}>
                                  {task.completed ? <FiCheckCircle size={20} /> : <FiCircle size={20} />}
                                </TaskStatus>
                                <TaskName>{task.name}</TaskName>
                                <TaskDate>
                                  <FiCalendar size={14} />
                                  {formatDate(task.taskDate)}
                                </TaskDate>
                                <TaskAction completed={task.completed}>
                                  {task.completed ? '✓ 完了' : '● 未実施'}
                                </TaskAction>
                                <WarningIcon>
                                  {isOverdue && <FiAlertCircle size={20} title="期限切れ" />}
                                </WarningIcon>
                              </TaskItem>
                            );
                          })}
                        </TaskList>
                      ) : (
                        <p>開始予定日を設定してください。</p>
                      )}
                    </DealCard>
                  );
                })}

                {/* 完了済みセクション */}
                {completedDealsList.length > 0 && (
                  <DoneSection>
                    <SectionDivider />
                    <SectionTitle>
                      <FiCheckCircle size={20} />
                      タスクDone（{completedDealsList.length}件）
                    </SectionTitle>
                    {completedDealsList.map(deal => {
                      const template = taskTemplates[deal.id];
                      return (
                        <DoneDealCard key={deal.id}>
                          <DealHeader>
                            <DealInfo>
                              <DealName>{deal.productName}</DealName>
                              <DealMeta>
                                <span>担当: {deal.representative}</span>
                                {template && (
                                  <span>受注日: {formatDate(template.receivedOrderDate)}</span>
                                )}
                                <span>開始予定: {formatDate(deal.nextActionDate)}</span>
                              </DealMeta>
                            </DealInfo>
                            <EditButton onClick={() => {
                              setEditingDeal(deal.id);
                              setReceivedOrderDate(template?.startDate || '');
                            }}>
                              <FiEdit3 />
                              開始日変更
                            </EditButton>
                          </DealHeader>
                          
                          {template && (
                            <TaskList>
                              {template.tasks.map((task, index) => (
                                <TaskItem 
                                  key={index} 
                                  onClick={() => toggleTaskStatus(deal.id, index)}
                                  isOverdue={false}
                                >
                                  <TaskStatus completed={task.completed}>
                                    {task.completed ? <FiCheckCircle size={20} /> : <FiCircle size={20} />}
                                  </TaskStatus>
                                  <TaskName>{task.name}</TaskName>
                                  <TaskDate>
                                    <FiCalendar size={14} />
                                    {formatDate(task.taskDate)}
                                  </TaskDate>
                                  <TaskAction completed={task.completed}>
                                    {task.completed ? '✓ 完了' : '● 未実施'}
                                  </TaskAction>
                                  <WarningIcon>
                                    {/* 完了済みセクションではアラートアイコンを表示しない */}
                                  </WarningIcon>
                                </TaskItem>
                              ))}
                            </TaskList>
                          )}
                        </DoneDealCard>
                      );
                    })}
                  </DoneSection>
                )}
              </>
            );
          })()}
        </>
      )}

      {editingDeal && (
        <EditModal onClick={() => setEditingDeal(null)}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>開始予定日の設定</ModalTitle>
              <CloseButton onClick={() => setEditingDeal(null)}>
                <FiX size={20} />
              </CloseButton>
            </ModalHeader>
            
            <InfoText>
              ※ 受注日は成約案件一覧の確定日を参照します
            </InfoText>
            
            <FormGroup>
              <Label>開始予定日 *</Label>
              <Input
                type="date"
                value={receivedOrderDate}
                onChange={(e) => setReceivedOrderDate(e.target.value)}
              />
            </FormGroup>
            
            <ButtonGroup>
              <Button className="secondary" onClick={() => setEditingDeal(null)}>
                キャンセル
              </Button>
              <Button className="primary" onClick={updateStartDate}>
                <FiSave />
                保存
              </Button>
            </ButtonGroup>
          </ModalContent>
        </EditModal>
      )}
    </PageContainer>
  );
};

export default TaskProgressPage;