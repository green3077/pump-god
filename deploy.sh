#!/bin/sh
# 배포: version.js에 현재 시각(연도-월-일 시:분)을 기록하고 커밋·푸시
set -e
cd "$(dirname "$0")"
V=$(date '+%Y-%m-%d %H:%M')   # 이 PC 로컬(한국) 시각
echo "const APP_VERSION = '$V';" > version.js
git add -A
git commit -qm "${1:-배포} ($V)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
echo "배포 버전: $V ($(git rev-parse --short HEAD))"
