#!/bin/sh
# 루트의 웹 소스를 www/로 복사하고 cap sync로 android 빌드 자산·플러그인 설정까지 반영한다.
# GitHub Pages는 저장소 루트를 그대로 서빙하므로 웹 코드는 항상 루트 파일을 고칠 것.
set -e
cd "$(dirname "$0")"
rm -rf www && mkdir -p www
cp -r index.html style.css app.js version.js manifest.json icon.svg logo.jpg vendor www/
npx cap sync android
echo "www/ → android assets 동기화 완료"
