# 펌프의신

소화펌프 성능시험 도우미 웹앱 (순수 HTML/CSS/JS, 빌드 없음)

- 정격양정·정격토출량 입력 → 체절(140% 이하)/정격(100%)/150%(65% 이상) 기준 자동 계산·판정
- 성능시험 결과서를 PDF 또는 이미지(PNG)로 저장·공유
- 하단 탭: 시험 · 현장 · 시험방법(펌프구조 / 기준 전환) · 기록

로컬 실행: `node serve.js` → http://localhost:8080

배포: `sh deploy.sh "변경 내용"` → version.js에 배포 시각(YYYY-MM-DD HH:MM)을 기록하고 커밋·푸시 (앱 상단에 표시됨)

## 안드로이드 APK (Capacitor)
- 최초 1회: `npm install`, `android/local.properties`에 `sdk.dir=C:\Users\<사용자>\AppData\Local\Android\Sdk` 작성(gitignore 대상)
- 웹 소스 수정 후: `sh build-android-www.sh` (www/ 복사 + `cap sync android`)
- 빌드: `cd android && ./gradlew assembleRelease` → `android/app/build/outputs/apk/release/app-release.apk`
- 서명: 저장소에 커밋된 `android/app/debug.keystore` (어느 PC에서 빌드해도 덮어설치 가능)
- 버전: `android/app/build.gradle`의 versionCode/versionName
