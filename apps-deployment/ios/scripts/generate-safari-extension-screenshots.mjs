#!/usr/bin/env node
// Generate App Store screenshots that show the browser extension in use.
//
// The existing simulator screenshot flow captures each native host app. This
// renderer adds a second, store-only screenshot per app showing the browser page
// surface with the extension overlay or popup visible. It intentionally omits
// status bars and notches so the output matches App Store screenshot policy
// used by `take-screenshots.sh --mask=ignored`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-extension-shots-'));
const messagesCache = new Map();
const onlyApps = new Set((process.env.SAFARI_EXTENSION_SCREENSHOT_APPS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));

const devices = [
  { key: 'iphone', width: 1320, height: 2868 },
  { key: 'ipad', width: 2064, height: 2752 },
  { key: 'desktop', width: 2880, height: 1800 },
];

const apps = [
  {
    dir: 'utilities/autoscroll',
    slug: 'autoscroll',
    color: '#0a84ff',
    url: 'reader.example',
    text: {
      ko: {
        name: '오토스크롤',
        title: '긴 글을 손대지 않고 읽기',
        subtitle: '브라우저 페이지 위에서 자동 스크롤 컨트롤을 바로 실행합니다.',
        eyebrow: '브라우저 확장 프로그램 실행 중',
        pageTitle: '오늘의 긴 읽을거리',
        pageMeta: '12분 읽기 · 자동 스크롤 80 px/s',
        overlayLabel: '80 px/s',
        body: ['스크롤이 필요한 긴 문서도 화면을 터치하지 않고 이어서 읽을 수 있습니다.', '오버레이 버튼으로 시작, 속도 조절, 방향 전환을 브라우저 페이지 안에서 처리합니다.'],
      },
      en: {
        name: 'AutoScroll',
        title: 'Read long pages hands-free',
        subtitle: 'Run auto-scroll controls directly on the browser page.',
        eyebrow: 'Browser extension running',
        pageTitle: 'Long Read of the Day',
        pageMeta: '12 min read · Auto-scroll 80 px/s',
        overlayLabel: '80 px/s',
        body: ['Read long documents without touching the screen.', 'Start, adjust speed, and reverse direction from the on-page overlay.'],
      },
    },
    extension: 'autoscroll',
  },
  {
    dir: 'utilities/auto-refresh',
    slug: 'auto-refresh',
    color: '#30d158',
    url: 'stock.example',
    text: {
      ko: {
        name: '새로고침',
        title: '페이지를 자동으로 새로고침',
        subtitle: '카운트다운, 위치 복원, 필요할 때만 켜는 랜덤 지연을 브라우저 안에서 실행합니다.',
        eyebrow: '브라우저 확장 프로그램 실행 중',
        pageTitle: '실시간 재고 확인',
        pageMeta: '다음 갱신까지 58초 · 랜덤 지연 OFF',
        button: '구매하기',
        overlayLabel: '다음 새로고침 58초',
        body: ['페이지가 새로고침되어도 스크롤 위치를 복원합니다.', '원하는 텍스트가 보이면 버튼이나 링크를 한 번 클릭하고 자동 새로고침을 멈춥니다.'],
      },
      en: {
        name: 'Auto Refresh',
        title: 'Refresh browser pages automatically',
        subtitle: 'Run countdown, scroll restore, and optional random delay inside the browser.',
        eyebrow: 'Browser extension running',
        pageTitle: 'Live Stock Monitor',
        pageMeta: '58s to next refresh · random delay off',
        button: 'Buy Now',
        overlayLabel: 'Next refresh in 58s',
        body: ['Scroll position is restored after each refresh.', 'When matching text appears, the extension clicks once and stops refreshing.'],
      },
    },
    extension: 'refresh',
  },
  {
    dir: 'utilities/web-screenshot',
    slug: 'web-screenshot',
    color: '#6e5cff',
    url: 'archive.example',
    text: {
      ko: {
        name: '스크린샷',
        title: '브라우저 웹페이지를 PNG로 저장',
        subtitle: '보이는 영역 또는 긴 전체 페이지를 로컬에서 캡처합니다.',
        eyebrow: '브라우저 확장 프로그램 팝업',
        pageTitle: '리서치 페이지',
        pageMeta: '전체 페이지 길이 38,420 px',
        primary: '전체 페이지',
        secondary: '보이는 영역',
        status: '캡처 준비 완료',
        body: ['페이지를 서버로 보내지 않고 브라우저 안에서 캡처합니다.', '상단 헤더 포함, 최대 길이, 캡처 지연을 상황에 맞게 조절할 수 있습니다.'],
      },
      en: {
        name: 'Screenshot',
        title: 'Save browser pages as PNG',
        subtitle: 'Capture the visible area or a long full page locally.',
        eyebrow: 'Browser extension popup',
        pageTitle: 'Research Page',
        pageMeta: 'Full page length 38,420 px',
        primary: 'Full Page',
        secondary: 'Visible Area',
        status: 'Ready to capture',
        body: ['Capture without sending the page to a server.', 'Tune header capture, maximum length, and delay for slow pages.'],
      },
    },
    extension: 'screenshot',
  },
  {
    dir: 'utilities/autoscripts',
    slug: 'autoscripts',
    color: '#bf5af2',
    url: 'docs.example',
    text: {
      ko: {
        name: 'Autoscripts',
        title: '브라우저 userscript 직접 관리',
        subtitle: '원하는 사이트에만 로컬 userscript를 실행하고 권한을 확인합니다.',
        eyebrow: '브라우저 확장 프로그램 실행 중',
        pageTitle: '문서 페이지',
        pageMeta: 'example.com · Reader Width Guard 실행 가능',
        primary: '대시보드 열기',
        secondary: '스크립트 비활성화',
        status: '이 페이지와 일치하는 스크립트 2개',
        body: ['페이지와 일치하는 스크립트만 표시하고 차단한 사이트에서는 실행하지 않습니다.', 'GM 저장소, 업데이트 상태, 사이트별 비활성화를 로컬에서 유지합니다.'],
      },
      en: {
        name: 'Autoscripts',
        title: 'Manage browser userscripts',
        subtitle: 'Run local userscripts only on matching sites after reviewing permissions.',
        eyebrow: 'Browser extension running',
        pageTitle: 'Documentation Page',
        pageMeta: 'example.com · Reader Width Guard can run',
        primary: 'Open Dashboard',
        secondary: 'Disable Script',
        status: '2 scripts match this page',
        body: ['Only matching scripts are shown, and blacklisted sites never run scripts.', 'GM storage, update state, and per-site disabled state stay local.'],
      },
    },
    extension: 'autoscripts',
  },
];

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function messages(app, locale) {
  const key = `${app.slug}:${locale}`;
  if (messagesCache.has(key)) return messagesCache.get(key);
  const messageLocale = locale === 'ko' ? 'ko' : 'en';
  const messagesPath = path.join(root, app.dir, 'ExtensionResources', '_locales', messageLocale, 'messages.json');
  const data = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
  const flat = Object.fromEntries(Object.entries(data).map(([name, value]) => [name, value.message]));
  messagesCache.set(key, flat);
  return flat;
}

function message(app, locale, key, fallback = key) {
  return messages(app, locale)[key] ?? fallback;
}

function extensionPanel(app, locale) {
  const m = (key, fallback) => htmlEscape(message(app, locale, key, fallback));
  if (app.extension === 'autoscroll') {
    return `<div class="actualPanel autoscrollPanel">
      <header><strong>${m('appName', 'AutoScroll')}</strong><span>${m('statusRunning', 'Scrolling')}</span></header>
      <section class="actualControls four">
        <button class="primary">${m('stop', 'Pause')}</button>
        <button>-</button>
        <button>+</button>
        <button>${m('directionDown', 'Down')}</button>
      </section>
      <label><span>${m('speed', 'Speed')}</span><output>80 px/s</output><div class="slider"><div style="width: 42%"></div></div></label>
      <label><span>${m('timer', 'Timer')}</span><div class="select">${m('off', 'Off')}</div></label>
      <div class="checkGrid">
        <div class="check on"><span></span>${m('showOverlay', 'On-page controls')}</div>
        <div class="check on"><span></span>${m('doubleTapToggle', 'Double-tap toggle')}</div>
        <div class="check"><span></span>${m('swipeMode', 'Swipe mode')}</div>
        <div class="check"><span></span>${m('loopAtEnd', 'Loop at page end')}</div>
      </div>
    </div>`;
  }
  if (app.extension === 'refresh') {
    return `<div class="actualPanel refreshPanel">
      <header><strong>${m('appName', 'Auto Refresh')}</strong><span>${m('nextInSeconds', 'Next $1s').replace('$1', '58')}</span></header>
      <section class="actualControls two">
        <button class="primary">${m('stop', 'Stop')}</button>
        <button>${m('refreshNow', 'Now')}</button>
      </section>
      <label><span>${m('interval', 'Interval')}</span><output>60s</output><div class="slider"><div style="width: 10%"></div></div></label>
      <div class="presetRow"><button>${m('fifteenSeconds', '15s')}</button><button>${m('thirtySeconds', '30s')}</button><button class="selected">${m('oneMinute', '1m')}</button><button>${m('threeMinutes', '3m')}</button><button>${m('fiveMinutes', '5m')}</button></div>
      <section class="miniPanel">
        <div class="check"><span></span>${m('randomDelay', 'Random delay')}</div>
        <div class="numberRow"><div><small>${m('minimumMs', 'Minimum ms')}</small><strong>0</strong></div><div><small>${m('maximumMs', 'Maximum ms')}</small><strong>1200</strong></div></div>
      </section>
      <section class="miniPanel">
        <div class="check"><span></span>${m('textMatchClick', 'Text match click')}</div>
        <div class="textInput">${m('textPlaceholder', 'Example: Reserve, Buy, Next')}</div>
      </section>
      <div class="checkGrid">
        <div class="check on"><span></span>${m('showCountdown', 'Show countdown')}</div>
        <div class="check on"><span></span>${m('preserveScroll', 'Restore scroll position')}</div>
      </div>
    </div>`;
  }
  if (app.extension === 'autoscripts') {
    return `<div class="actualPanel autoscriptsPanel">
      <header><strong>${m('popupUserscripts', 'Userscripts')}</strong><span>2 ${m('popupMatchingThisPage', 'matching this page')}</span></header>
      <section class="miniPanel scriptCard">
        <strong>Reader Width Guard</strong>
        <small>GM_addStyle · ${m('popupUpdateStatus', 'Update: current').replace('$1', 'current')}</small>
        <div class="actualControls two">
          <button>${m('popupDisableScript', 'Disable Script')}</button>
          <button>${m('popupEditInApp', 'Edit in App')}</button>
        </div>
      </section>
      <section class="miniPanel scriptCard blocked">
        <strong>Quick Menu Commands</strong>
        <small>Script disabled</small>
        <div class="actualControls two">
          <button class="primary">${m('popupEnableScript', 'Enable Script')}</button>
          <button>${m('popupCheckUpdate', 'Check Update')}</button>
        </div>
      </section>
      <div class="checkGrid">
        <div class="check on"><span></span>${m('popupSafeMode', 'Safe Mode')}</div>
        <div class="check"><span></span>${m('popupDisableOnThisSite', 'Disable on This Site')}</div>
      </div>
      <section class="actualControls two">
        <button class="primary">${m('popupOpenDashboard', 'Open Dashboard')}</button>
        <button>${m('popupCheckPageUpdates', 'Check Page Updates')}</button>
      </section>
    </div>`;
  }
  return `<div class="actualPanel screenshotPanel">
    <header><strong>${m('appName', 'Web Screenshot')}</strong><span>${m('statusReady', 'Ready')}</span></header>
    <section class="actualControls two">
      <button class="primary">${m('fullPage', 'Full Page')}</button>
      <button>${m('visibleArea', 'Visible Area')}</button>
    </section>
    <label><span>${m('maxLength', 'Max Length')}</span><output>40000px</output><div class="slider"><div style="width: 100%"></div></div></label>
    <label><span>${m('quality', 'Quality')}</span><div class="select">${m('highQuality', 'High')}</div></label>
    <label><span>${m('captureSpeed', 'Capture Speed')}</span><div class="select">${m('normal', 'Normal')}</div></label>
    <div class="checkGrid">
      <div class="check on"><span></span>${m('includeHeader', 'Include top header')}</div>
    </div>
    <div class="progressTrack"><div></div></div>
  </div>`;
}

function html(app, locale, device, mode = 'usage') {
  const copy = app.text[locale === 'ko' ? 'ko' : 'en'];
  const isPad = device.key === 'ipad';
  const isDesktop = device.key === 'desktop';
  const pageWidth = isPad ? 1180 : 980;
  const isExtensionUi = mode === 'extension-ui';
  const uiTitle = app.extension === 'autoscroll' || app.extension === 'refresh' || app.extension === 'screenshot'
    ? (locale === 'ko' ? '브라우저 확장 프로그램 설정' : 'Browser extension controls')
    : (locale === 'ko' ? '브라우저 확장 프로그램 설정' : 'Browser extension controls');
  const uiSubtitle = locale === 'ko'
    ? '실제 팝업에서 시작, 옵션 변경, 캡처 실행을 바로 조작합니다.'
    : 'Use the real popup to start, tune options, and run the action.';
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${device.width}, initial-scale=1">
<style>
* { box-sizing: border-box; }
html, body { margin: 0; width: ${device.width}px; height: ${device.height}px; overflow: hidden; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
  background: #f4f5f8;
  color: #15171a;
  letter-spacing: 0;
}
.screen {
  width: ${device.width}px;
  height: ${device.height}px;
  padding: ${isDesktop ? '90px 160px' : isPad ? '96px 132px' : '76px 70px'};
  display: grid;
  grid-template-rows: auto 1fr;
  gap: ${isDesktop ? '42px' : isPad ? '54px' : '42px'};
}
.hero h1 {
  margin: 10px 0 18px;
  font-size: ${isDesktop ? '70px' : isPad ? '86px' : '74px'};
  line-height: 1.02;
  letter-spacing: 0;
}
.hero p { margin: 0; max-width: ${isDesktop ? '1500px' : isPad ? '1160px' : '980px'}; font-size: ${isDesktop ? '30px' : isPad ? '35px' : '31px'}; line-height: 1.28; color: #4d535c; }
.eyebrow { font-size: ${isDesktop ? '22px' : isPad ? '25px' : '23px'}; font-weight: 700; color: ${app.color}; }
.browser {
  width: 100%;
  height: 100%;
  border-radius: ${isPad ? '34px' : '30px'};
  overflow: hidden;
  background: #fff;
  box-shadow: 0 30px 90px rgba(28, 32, 39, .18);
  display: grid;
  grid-template-rows: ${isPad ? '86px' : '78px'} 1fr;
}
.toolbar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 18px;
  padding: 14px 20px;
  background: rgba(248, 249, 251, .96);
  border-bottom: 1px solid #e4e6eb;
}
.traffic, .actions { display: flex; gap: 10px; align-items: center; }
.dot { width: 16px; height: 16px; border-radius: 50%; background: #c9cdd5; }
.address {
  height: ${isPad ? '52px' : '48px'};
  border-radius: 999px;
  background: #eceff3;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: ${isPad ? '24px' : '22px'};
  color: #39404a;
  font-weight: 650;
}
.actionIcon {
  width: ${isPad ? '48px' : '44px'};
  height: ${isPad ? '48px' : '44px'};
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: ${app.color};
  color: white;
  font-weight: 800;
  font-size: ${isPad ? '25px' : '23px'};
}
.page {
  position: relative;
  overflow: hidden;
  padding: ${isPad ? '58px 68px' : '48px 54px'};
  background:
    linear-gradient(180deg, rgba(255,255,255,.94), rgba(255,255,255,.88)),
    repeating-linear-gradient(0deg, #f7f8fa 0, #f7f8fa 86px, #eef1f5 87px, #eef1f5 88px);
}
.article {
  max-width: ${isDesktop ? '1460px' : `${pageWidth}px`};
  margin: 0 auto;
}
.article h2 { margin: 0 0 14px; font-size: ${isPad ? '54px' : '46px'}; line-height: 1.05; }
.meta { color: #66707d; font-size: ${isPad ? '25px' : '22px'}; margin-bottom: 34px; }
.paragraph {
  height: ${isPad ? '34px' : '30px'};
  border-radius: 999px;
  background: #dfe3ea;
  margin: 18px 0;
}
.paragraph.short { width: 62%; }
.paragraph.mid { width: 82%; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 38px 0; }
.card { min-height: ${isPad ? '170px' : '150px'}; border-radius: 22px; background: #f1f3f7; padding: 24px; border: 1px solid #e4e7ed; }
.card strong { display: block; font-size: ${isPad ? '28px' : '25px'}; margin-bottom: 12px; }
.card span { display: block; font-size: ${isPad ? '22px' : '20px'}; color: #66707d; line-height: 1.35; }
.buy { margin-top: 24px; border: 0; border-radius: 16px; background: #111318; color: white; padding: 20px 28px; font-size: ${isPad ? '26px' : '24px'}; font-weight: 750; }
.autoscrollOverlay {
  position: absolute;
  right: ${isPad ? '56px' : '42px'};
  bottom: ${isPad ? '52px' : '44px'};
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 9px;
  border-radius: 999px;
  background: rgba(16, 18, 22, 0.74);
  color: white;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .26);
  backdrop-filter: blur(18px);
}
.autoscrollOverlay button {
  width: ${isPad ? '52px' : '48px'};
  height: ${isPad ? '52px' : '48px'};
  border: 0;
  border-radius: 999px;
  color: white;
  background: rgba(255,255,255,.16);
  font-size: ${isPad ? '24px' : '22px'};
  font-weight: 700;
}
.autoscrollOverlay button.primary { background: #0a84ff; }
.autoscrollOverlay span { min-width: ${isPad ? '84px' : '78px'}; text-align: center; font-size: ${isPad ? '18px' : '16px'}; }
.refreshOverlay {
  position: absolute;
  right: ${isPad ? '58px' : '44px'};
  bottom: ${isPad ? '56px' : '46px'};
  border: 0;
  border-radius: 999px;
  padding: ${isPad ? '20px 25px' : '18px 22px'};
  color: white;
  background: rgba(17, 18, 21, .78);
  box-shadow: 0 10px 30px rgba(0,0,0,.24);
  backdrop-filter: blur(18px);
  font-weight: 750;
  font-size: ${isPad ? '24px' : '21px'};
}
.popup {
  position: absolute;
  right: ${isPad ? '58px' : '44px'};
  top: ${isPad ? '58px' : '48px'};
  width: ${isPad ? '430px' : '380px'};
  border-radius: 24px;
  background: rgba(255,255,255,.96);
  border: 1px solid #e2e5ec;
  box-shadow: 0 26px 80px rgba(20, 24, 32, .22);
  padding: ${isPad ? '26px' : '23px'};
}
.popup h3 { margin: 0 0 6px; font-size: ${isPad ? '30px' : '27px'}; }
.popup .status { color: #66707d; font-size: ${isPad ? '21px' : '19px'}; margin-bottom: 20px; }
.popup .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.popup button { border: 0; border-radius: 14px; padding: 15px 12px; font-size: ${isPad ? '21px' : '19px'}; font-weight: 760; background: #eef0f5; }
.popup button.primary { background: ${app.color}; color: white; }
.popup .progress { margin-top: 20px; height: 9px; border-radius: 999px; background: #e7e9ef; overflow: hidden; }
.popup .progress div { width: 72%; height: 100%; background: ${app.color}; }
.actualPanel {
  position: absolute;
  right: ${isPad ? '82px' : '60px'};
  top: ${isPad ? '78px' : '64px'};
  width: ${isPad ? '560px' : '500px'};
  max-height: calc(100% - ${isPad ? '156px' : '128px'});
  overflow: hidden;
  display: grid;
  gap: ${isPad ? '18px' : '16px'};
  padding: ${isPad ? '28px' : '24px'};
  border-radius: ${isPad ? '30px' : '26px'};
  background: color-mix(in srgb, white 94%, ${app.color} 6%);
  border: 1px solid rgba(226, 230, 238, .92);
  box-shadow: 0 30px 92px rgba(20, 24, 32, .26);
}
.actualPanel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.actualPanel header strong { font-size: ${isPad ? '32px' : '28px'}; }
.actualPanel header span {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #68717e;
  font-size: ${isPad ? '21px' : '19px'};
  padding: 8px 13px;
  border-radius: 999px;
  background: rgba(21, 24, 30, .08);
}
.actualControls { display: grid; gap: 10px; }
.actualControls.two { grid-template-columns: 1fr 1fr; }
.actualControls.four { grid-template-columns: 1.45fr 54px 54px 82px; }
.actualPanel button {
  min-height: ${isPad ? '54px' : '48px'};
  border: 0;
  border-radius: 12px;
  padding: 0 16px;
  font-size: ${isPad ? '22px' : '19px'};
  font-weight: 740;
  background: rgba(20, 24, 32, .10);
  color: #161a21;
}
.actualPanel button.primary,
.presetRow button.selected {
  background: ${app.color};
  color: white;
}
.actualPanel label {
  display: grid;
  gap: 9px;
  font-size: ${isPad ? '22px' : '19px'};
  color: #171b22;
}
.actualPanel output {
  justify-self: end;
  margin-top: ${isPad ? '-34px' : '-30px'};
  color: #68717e;
  font-size: ${isPad ? '20px' : '18px'};
}
.slider {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: rgba(22, 25, 31, .14);
  overflow: hidden;
}
.slider div { height: 100%; border-radius: 999px; background: ${app.color}; }
.select,
.textInput {
  min-height: ${isPad ? '50px' : '44px'};
  border-radius: 12px;
  border: 1px solid rgba(21, 24, 31, .16);
  background: rgba(255, 255, 255, .72);
  display: flex;
  align-items: center;
  padding: 0 14px;
  color: #303743;
  font-size: ${isPad ? '21px' : '18px'};
}
.presetRow {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.presetRow button {
  min-height: ${isPad ? '46px' : '40px'};
  padding: 0;
  font-size: ${isPad ? '18px' : '16px'};
}
.miniPanel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(21, 24, 31, .07);
}
.numberRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.numberRow div {
  min-height: ${isPad ? '58px' : '52px'};
  border-radius: 12px;
  border: 1px solid rgba(21, 24, 31, .14);
  background: rgba(255,255,255,.62);
  padding: 7px 10px;
}
.numberRow small { display: block; color: #68717e; font-size: ${isPad ? '16px' : '14px'}; }
.numberRow strong { display: block; margin-top: 2px; font-size: ${isPad ? '22px' : '19px'}; }
.checkGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}
.check {
  min-height: ${isPad ? '50px' : '44px'};
  border-radius: 12px;
  background: rgba(21, 24, 31, .07);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  font-size: ${isPad ? '19px' : '17px'};
  color: #242a34;
}
.check span {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 2px solid rgba(21, 24, 31, .28);
  flex: none;
}
.check.on span {
  border-color: ${app.color};
  background: ${app.color};
  box-shadow: inset 0 0 0 3px white;
}
.progressTrack {
  height: 10px;
  border-radius: 999px;
  background: rgba(21, 24, 31, .12);
  overflow: hidden;
}
.progressTrack div { width: 62%; height: 100%; background: ${app.color}; }
.scriptCard strong { display: block; font-size: ${isPad ? '24px' : '21px'}; margin-bottom: 4px; }
.scriptCard small { display: block; color: #68717e; font-size: ${isPad ? '17px' : '15px'}; margin-bottom: 12px; }
.scriptCard.blocked { background: rgba(21, 24, 31, .055); }
.caption {
  position: absolute;
  left: ${isPad ? '68px' : '54px'};
  bottom: ${isPad ? '62px' : '54px'};
  max-width: ${isPad ? '680px' : '610px'};
  padding: ${isPad ? '28px 30px' : '24px 26px'};
  border-radius: 24px;
  background: rgba(255,255,255,.9);
  border: 1px solid rgba(224, 228, 236, .82);
  box-shadow: 0 16px 52px rgba(23, 29, 38, .13);
}
.caption strong { display: block; font-size: ${isPad ? '28px' : '25px'}; margin-bottom: 8px; }
.caption span { display: block; font-size: ${isPad ? '22px' : '20px'}; line-height: 1.34; color: #4f5966; }
</style>
</head>
<body>
  <main class="screen">
    <section class="hero">
      <div class="eyebrow">${htmlEscape(isExtensionUi ? (locale === 'ko' ? copy.name : copy.name) : copy.eyebrow)}</div>
      <h1>${htmlEscape(isExtensionUi ? uiTitle : copy.title)}</h1>
      <p>${htmlEscape(isExtensionUi ? uiSubtitle : copy.subtitle)}</p>
    </section>
    <section class="browser">
      <div class="toolbar">
        <div class="traffic"><span class="dot"></span><span class="dot"></span></div>
        <div class="address"><span>AA</span><span>${htmlEscape(app.url)}</span></div>
        <div class="actions"><div class="actionIcon">${app.extension === 'autoscroll' ? '↓' : app.extension === 'refresh' ? '↻' : '▣'}</div></div>
      </div>
      <div class="page">
        <article class="article">
          <h2>${htmlEscape(copy.pageTitle)}</h2>
          <div class="meta">${htmlEscape(copy.pageMeta)}</div>
          <div class="paragraph"></div><div class="paragraph mid"></div><div class="paragraph short"></div>
          <div class="cards">
            <div class="card"><strong>${htmlEscape(copy.body[0])}</strong><span>${htmlEscape(copy.body[1])}</span>${copy.button ? `<button class="buy">${htmlEscape(copy.button)}</button>` : ''}</div>
            <div class="card"><strong>${htmlEscape(copy.name)}</strong><span>${htmlEscape(copy.subtitle)}</span></div>
          </div>
          <div class="paragraph"></div><div class="paragraph mid"></div><div class="paragraph"></div><div class="paragraph short"></div>
        </article>
        ${!isExtensionUi && app.extension === 'autoscroll' ? `<div class="autoscrollOverlay"><button class="primary">Ⅱ</button><button>−</button><span>${htmlEscape(copy.overlayLabel)}</span><button>+</button><button>↓</button></div>` : ''}
        ${!isExtensionUi && app.extension === 'refresh' ? `<button class="refreshOverlay">${htmlEscape(copy.overlayLabel)}</button>` : ''}
        ${!isExtensionUi && (app.extension === 'screenshot' || app.extension === 'autoscripts') ? `<div class="popup"><h3>${htmlEscape(copy.name)}</h3><div class="status">${htmlEscape(copy.status)}</div><div class="grid"><button class="primary">${htmlEscape(copy.primary)}</button><button>${htmlEscape(copy.secondary)}</button></div><div class="progress"><div></div></div></div>` : ''}
        ${isExtensionUi ? extensionPanel(app, locale) : ''}
        <div class="caption"><strong>${htmlEscape(isExtensionUi ? copy.eyebrow : copy.eyebrow)}</strong><span>${htmlEscape(copy.body[0])}</span></div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function chromeShot(input, output, device) {
  const args = [
    '--headless=new',
    '--hide-scrollbars',
    '--disable-gpu',
    '--no-first-run',
    `--window-size=${device.width},${device.height}`,
    `--screenshot=${output}`,
    `file://${input}`,
  ];
  const result = spawnSync(chrome, args, { stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(`Chrome screenshot failed: ${result.stderr.toString() || result.stdout.toString()}`);
  }
}

for (const app of apps) {
  if (onlyApps.size > 0 && !onlyApps.has(app.slug)) {
    continue;
  }
  for (const locale of ['ko', 'en-US']) {
    for (const device of devices) {
      const outDir = path.join(root, app.dir, 'screenshots', locale);
      fs.mkdirSync(outDir, { recursive: true });
      const htmlPath = path.join(tmpRoot, `${app.slug}-${locale}-${device.key}.html`);
      const outPath = path.join(outDir, `${device.key}-2-browser.png`);
      fs.writeFileSync(htmlPath, html(app, locale, device, 'usage'));
      chromeShot(htmlPath, outPath, device);
      console.log(`generated ${outPath}`);

      const uiHtmlPath = path.join(tmpRoot, `${app.slug}-${locale}-${device.key}-extension-ui.html`);
      const uiOutPath = path.join(outDir, `${device.key}-3-extension-ui.png`);
      fs.writeFileSync(uiHtmlPath, html(app, locale, device, 'extension-ui'));
      chromeShot(uiHtmlPath, uiOutPath, device);
      console.log(`generated ${uiOutPath}`);
    }
  }
}
