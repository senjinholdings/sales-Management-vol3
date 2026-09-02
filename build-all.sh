#!/bin/bash

echo "🔨 管理者用とパートナー用アプリをビルド中..."

# distディレクトリをクリーンアップ
if [ -d "dist" ]; then
  rm -rf dist
fi
mkdir -p dist/admin dist/partner

# 管理者用アプリをビルド
echo "📊 管理者用アプリをビルド中..."
PUBLIC_URL=/admin npm run build
cp -r build/* dist/admin/

# 管理者用のHTMLファイルのタイトル更新
sed -i '' 's/<title>.*<\/title>/<title>営業管理システム<\/title>/' dist/admin/index.html

# パートナー用アプリをビルド
echo "🤝 パートナー用アプリをビルド中..."
REACT_APP_ENTRY_POINT=partner PUBLIC_URL=/partner npm run build
cp -r build/* dist/partner/

# パートナー用のHTMLファイルのタイトル更新
sed -i '' 's/<title>.*<\/title>/<title>営業パートナー専用システム<\/title>/' dist/partner/index.html

echo "✅ ビルド完了!"
echo "📁 管理者用: dist/admin/"
echo "📁 パートナー用: dist/partner/"
echo ""
echo "🌐 デプロイ後のURL:"
echo "   管理者用: https://sales-management-staging.web.app/"
echo "   パートナー用: https://sales-management-staging.web.app/partner/"