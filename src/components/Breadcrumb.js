import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import styled from 'styled-components';
import { FiHome, FiChevronRight } from 'react-icons/fi';

const BreadcrumbContainer = styled.nav`
  background: white;
  padding: 1rem 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 1.5rem;
  border-bottom: 1px solid #f0f0f0;
`;

const BreadcrumbList = styled.ol`
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
`;

const BreadcrumbItem = styled.li`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  
  &:not(:last-child)::after {
    content: '';
    margin-left: 0.5rem;
  }
`;

const BreadcrumbLink = styled(Link)`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: #3498db;
  text-decoration: none;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  transition: all 0.2s ease;
  
  &:hover {
    background: #f8f9fa;
    color: #2980b9;
  }
`;

const BreadcrumbText = styled.span`
  color: #666;
  font-weight: 500;
`;

const Separator = styled(FiChevronRight)`
  color: #ccc;
  font-size: 0.75rem;
`;

// ページ名とパスの対応表
const routeConfig = {
  // 管理者用ルート
  '/': { name: 'ホーム', icon: FiHome },
  '/new-deals-dashboard': { name: '新規案件ダッシュボード', icon: null },
  '/existing-deals-dashboard': { name: '既存案件ダッシュボード', icon: null },
  '/progress-dashboard': { name: '新規案件一覧', icon: null },
  '/log-entry': { name: 'アクションログ記録', icon: null },
  '/action-logs': { name: 'アクションログ一覧', icon: null },
  '/closed-deals': { name: '成約案件一覧', icon: null },
  '/proposal-deals': { name: '提案案件一覧', icon: null },
  '/introducer-master': { name: '紹介者マスター', icon: null },
  '/proposal-menu-master': { name: '提案メニューマスター', icon: null },
  '/lead-source-master': { name: '流入経路マスター', icon: null },
  '/continuation-management': { name: '継続管理', icon: null },
  '/product': { name: '案件詳細', icon: null },
  '/if/list': { name: 'インフルエンサー一覧', icon: null },
  '/if/register': { name: 'インフルエンサー登録', icon: null },
  '/casting/manage': { name: 'キャスティング管理', icon: null },
  '/project-management': { name: '既存案件一覧', icon: null },
  '/staff-master': { name: '担当者管理', icon: null },
  '/operator-dashboard': { name: '運用管理', icon: null },
  '/next-action-management': { name: 'NA管理', icon: null },
  '/daily-timer': { name: '日報', icon: null },
  
  // パートナー用ルート
  '/partner': { name: 'ホーム', icon: FiHome },
  '/partner-entry/piala': { name: 'ホーム', icon: FiHome },
  '/partner/dashboard': { name: '案件一覧', icon: null },
  '/partner/entry': { name: 'アクションログ記録', icon: null },
  '/partner/action-logs': { name: 'ログ一覧', icon: null },
  '/partner/kanban': { name: '看板ボード', icon: null },
  '/partner/representatives': { name: '担当者マスター', icon: null },
  '/partner/sales-results': { name: '成約案件一覧', icon: null },
  '/partner/product': { name: '案件詳細', icon: null }
};

function Breadcrumb() {
  const location = useLocation();
  const pathname = location.pathname;
  
  // パートナー向けかどうかを判定
  const isPartnerView = pathname.startsWith('/partner');
  
  // パンくずリストを生成
  const generateBreadcrumbs = () => {
    const breadcrumbs = [];
    
    // ホームページの判定
    let homePath = '/';
    if (isPartnerView) {
      homePath = pathname.startsWith('/partner-entry/piala') ? '/partner-entry/piala' : '/partner';
    }
    
    // 現在のパスがホームページの場合
    if (pathname === homePath) {
      return [
        {
          path: homePath,
          name: routeConfig[homePath]?.name || 'ホーム',
          icon: routeConfig[homePath]?.icon,
          isActive: true
        }
      ];
    }
    
    // ホームを最初に追加
    breadcrumbs.push({
      path: homePath,
      name: routeConfig[homePath]?.name || 'ホーム',
      icon: routeConfig[homePath]?.icon,
      isActive: false
    });
    
    // 現在のページを判定
    let currentPageName = '不明なページ';
    let currentPagePath = pathname;
    
    // 案件詳細ページの特別処理
    if (pathname.includes('/product/')) {
      currentPageName = '案件詳細';
      currentPagePath = isPartnerView ? '/partner/product' : '/product';
    }
    // 完全一致チェック
    else if (routeConfig[pathname]) {
      currentPageName = routeConfig[pathname].name;
      currentPagePath = pathname;
    }
    // パートナー用のパス変換
    else if (isPartnerView) {
      // パートナー用のルートマッピング
      const partnerRouteMap = {
        '/partner-entry/piala/dashboard': '/partner/dashboard',
        '/partner-entry/piala/log-entry': '/partner/entry',
        '/partner-entry/piala/action-logs': '/partner/action-logs',
        '/partner-entry/piala/kanban': '/partner/kanban',
        '/partner-entry/piala/representative-master': '/partner/representatives',
        '/partner-entry/piala/sales-results': '/partner/sales-results'
      };
      
      const mappedPath = partnerRouteMap[pathname];
      if (mappedPath && routeConfig[mappedPath]) {
        currentPageName = routeConfig[mappedPath].name;
        currentPagePath = pathname;
      }
    }
    
    // 現在のページを追加
    breadcrumbs.push({
      path: currentPagePath,
      name: currentPageName,
      icon: null,
      isActive: true
    });
    
    return breadcrumbs;
  };
  
  const breadcrumbs = generateBreadcrumbs();
  
  return (
    <BreadcrumbContainer>
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => (
          <React.Fragment key={crumb.path}>
            <BreadcrumbItem>
              {crumb.isActive ? (
                <BreadcrumbText>
                  {crumb.icon && <crumb.icon />}
                  {crumb.name}
                </BreadcrumbText>
              ) : (
                <BreadcrumbLink to={crumb.path}>
                  {crumb.icon && <crumb.icon />}
                  {crumb.name}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {index < breadcrumbs.length - 1 && <Separator />}
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </BreadcrumbContainer>
  );
}

export default Breadcrumb;