/**
 * 페르소나 매니저 — SillyTavern 클라이언트 확장
 *
 * 진입점 두 개
 *   ① 입력창 ☰ 옆 현재 페르소나 얼굴 버튼 → 빠른 전환창
 *   ② 요술봉 메뉴 '페르소나 매니저' → 관리 화면
 * 덤으로 ST 원래 페르소나 탭에 태그 칩 줄 + ⭐ 를 끼워넣는다.
 *
 * ST 원본 파일은 한 줄도 고치지 않는다. 전환·개명·설명 수정은 전부 ST 원래 경로 경유.
 */

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

import { MODULE_NAME, cleanupOrphans, normalizeSettings, pushRecent } from './src/settings.js';
import {
    buildEntries, getAllAvatarIds, getCurrentAvatarId,
    refreshAvatarFiles, wireAvatarImage,
} from './src/st-bridge.js';
import { initSwitcher, openSwitcher, refreshSwitcher, toggleSwitcher } from './src/switcher.js';
import { initManager, openManager, refreshManager } from './src/manager.js';
import {
    initTabInject, injectIntoOriginalTab, renderChips, renderCurrentRow, watchOriginalTab,
} from './src/tab-inject.js';

const FACE_BUTTON_ID = 'pm_face_button';
const WAND_CONTAINER_ID = 'pm_wand_container';
const WAND_ITEM_ID = 'pm_wand_item';

let sideSurfaceTimer = null;

/**
 * 한 화면에서 한 변경을 다른 화면에도 비춘다.
 *
 * 관리 화면·전환창은 자기 render()로 알아서 갱신되지만, 원래 페르소나 탭의
 * 칩 줄·★·설정 서람 요약은 그 렌더에 안 끼어 묵은 값을 보여준다(E2E 실측:
 * 관리 화면에서 만든 태그가 원래 탭 칩 줄에 안 나타났다).
 * 호출부가 써야 할 걸 기억하게 두지 않고 save()에 묶어 둔다.
 * 여기서는 관리 화면·전환창을 부르지 않는다 — 그쪽 render가 다시 save를 부르는 일을 막는다.
 */
function scheduleSideSurfaceRefresh() {
    clearTimeout(sideSurfaceTimer);
    sideSurfaceTimer = setTimeout(() => {
        try {
            renderChips();
            renderCurrentRow();
            updateSettingsStat();
        } catch (err) {
            console.error('[persona-manager] 곁화면 갱신 실패', err);
        }
    }, 60);
}

/** 설정 접근자 — 호출부는 전부 이걸 쓴다. */
const store = {
    get() {
        if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
        extension_settings[MODULE_NAME] = normalizeSettings(extension_settings[MODULE_NAME]);
        return extension_settings[MODULE_NAME];
    },
    save() {
        saveSettingsDebounced();
        scheduleSideSurfaceRefresh();
    },
};

/** 얼굴 버튼 핸들(전역 재선택 금지 — 자매 배포본이 있으면 id가 두 벌이 된다) */
let $faceButton = null;

/**
 * 입력창 왼쪽(#leftSendForm)의 ☰ 옆에 현재 페르소나 얼굴 버튼을 넣는다.
 * @returns {boolean} 성공 여부
 */
function installFaceButton() {
    try {
        const form = document.querySelector('#leftSendForm');
        if (!form) return false;
        if (document.querySelector(`#${FACE_BUTTON_ID}`)) return true;

        const btn = document.createElement('div');
        btn.id = FACE_BUTTON_ID;
        btn.className = 'pm-face-button interactable';
        btn.title = '페르소나 바꾸기';
        btn.tabIndex = 0;

        const img = document.createElement('img');
        img.alt = '';
        btn.append(img);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSwitcher();
        });
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openSwitcher();
            }
        });

        const options = form.querySelector('#options_button');
        if (options) options.after(btn);
        else form.append(btn);

        $faceButton = btn;
        updateFaceButton();
        return true;
    } catch (err) {
        console.error('[persona-manager] 얼굴 버튼 설치 실패', err);
        return false;
    }
}

/** 얼굴 버튼 이미지를 현재 페르소나로 갱신한다. */
function updateFaceButton() {
    try {
        const btn = $faceButton ?? document.querySelector(`#${FACE_BUTTON_ID}`);
        const img = btn?.querySelector('img');
        if (!img) return;
        const avatarId = getCurrentAvatarId();
        if (!avatarId) return;
        delete img.dataset.pmFallback;
        wireAvatarImage(img, avatarId);
        btn.title = `페르소나 바꾸기 — 지금은 ${getCurrentName()}`;
    } catch (err) {
        console.error('[persona-manager] 얼굴 버튼 갱신 실패', err);
    }
}

function getCurrentName() {
    const id = getCurrentAvatarId();
    const entry = buildEntries(store.get()).find(e => e.avatarId === id);
    return entry?.name ?? id;
}

/**
 * 요술봉 메뉴에 항목을 넣는다.
 * third-party용 공용 컨테이너가 없으므로 우리 컨테이너를 만들어 #extensionsMenu에 붙인다.
 * @returns {boolean}
 */
function installWandItem() {
    try {
        const menu = document.querySelector('#extensionsMenu');
        if (!menu) return false;
        if (document.querySelector(`#${WAND_CONTAINER_ID}`)) return true;

        const container = document.createElement('div');
        container.id = WAND_CONTAINER_ID;
        container.className = 'extension_container';

        const item = document.createElement('div');
        item.id = WAND_ITEM_ID;
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;

        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-user-gear extensionsMenuExtensionButton';

        const label = document.createElement('span');
        label.textContent = '페르소나 매니저';

        item.append(icon, label);
        item.addEventListener('click', () => openManager());
        container.append(item);
        menu.append(container);
        return true;
    } catch (err) {
        console.error('[persona-manager] 요술봉 메뉴 항목 설치 실패', err);
        return false;
    }
}

/** 설정 서랍(상태 안내 + 관리 화면 열기 버튼) */
function installSettingsDrawer() {
    try {
        const host = document.querySelector('#extensions_settings2');
        if (!host || document.querySelector('#pm_settings_block')) return;

        const block = document.createElement('div');
        block.id = 'pm_settings_block';
        block.className = 'persona-manager-settings';
        block.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>페르소나 매니저</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="pm-settings-inner">
                        <div class="pm-settings-stat" id="pm_settings_stat"></div>
                        <div class="pm-btn pm-btn-primary" id="pm_settings_open">관리 화면 열기</div>
                        <div class="pm-btn" id="pm_settings_switch">빠른 전환창 열기</div>
                        <small class="pm-hint">입력창 왼쪽의 얼굴을 눌러도 빠른 전환창이 열려요.</small>
                    </div>
                </div>
            </div>`;
        host.append(block);

        block.querySelector('#pm_settings_open').addEventListener('click', () => openManager());
        block.querySelector('#pm_settings_switch').addEventListener('click', () => openSwitcher());
        updateSettingsStat();
    } catch (err) {
        console.error('[persona-manager] 설정 서랍 설치 실패', err);
    }
}

function updateSettingsStat() {
    try {
        const el = document.querySelector('#pm_settings_stat');
        if (!el) return;
        const s = store.get();
        const total = getAllAvatarIds().length;
        el.textContent = `페르소나 ${total}명 · 태그 ${s.tags.length}개 · 즐겨찾기 ${s.favorites.length}명`;
    } catch { /* 표시용이라 조용히 넘어간다 */ }
}

/** 어디선가 데이터가 바뀌었을 때 열려 있는 화면들을 전부 맞춘다. */
function refreshAll() {
    updateFaceButton();
    refreshSwitcher();
    refreshManager();
    renderChips();
    renderCurrentRow();
    updateSettingsStat();
}

/**
 * 상한 있는 재시도로 붙인다 — 우리 확장이 요술봉 템플릿보다 먼저 뜰 수 있다.
 * @param {function(): boolean} fn
 * @param {string} label
 */
function retryInstall(fn, label, tries = 20, delayMs = 300) {
    let left = tries;
    const tick = () => {
        let ok = false;
        try { ok = fn(); } catch (err) { console.error(`[persona-manager] ${label} 예외`, err); }
        if (ok) return;
        if (--left <= 0) {
            console.warn(`[persona-manager] ${label} — 붙일 자리를 찾지 못했습니다.`);
            return;
        }
        setTimeout(tick, delayMs);
    };
    tick();
}

jQuery(async () => {
    try {
        store.get();

        initSwitcher({ store, openManager: () => openManager() });
        initManager({ store, openSwitcher: () => openSwitcher() });
        initTabInject({ store });

        // 실존 아바타 파일을 받아 '사진 없음' 판정 근거를 만들고, 고아 데이터를 치운다
        await refreshAvatarFiles(true);
        const removed = cleanupOrphans(store.get(), getAllAvatarIds());
        if (removed.tags || removed.favorites || removed.recent) {
            console.log('[persona-manager] 고아 데이터 정리', removed);
            store.save();
        }

        // 현재 페르소나를 최근 목록에 올려 둔다(첫 로드)
        const current = getCurrentAvatarId();
        if (current) {
            pushRecent(store.get(), current);
            store.save();
        }

        retryInstall(installFaceButton, '입력창 얼굴 버튼');
        retryInstall(installWandItem, '요술봉 메뉴 항목');
        retryInstall(injectIntoOriginalTab, '원래 페르소나 탭 끼워넣기');
        installSettingsDrawer();
        watchOriginalTab();

        eventSource.on(event_types.PERSONA_CHANGED, () => {
            const id = getCurrentAvatarId();
            if (id) {
                pushRecent(store.get(), id);
                store.save();
            }
            refreshAll();
        });

        for (const evt of [event_types.PERSONA_UPDATED, event_types.PERSONA_RENAMED]) {
            eventSource.on(evt, () => refreshAll());
        }

        eventSource.on(event_types.PERSONA_CREATED, async () => {
            await refreshAvatarFiles(true);
            refreshAll();
        });

        eventSource.on(event_types.PERSONA_DELETED, async () => {
            await refreshAvatarFiles(true);
            const gone = cleanupOrphans(store.get(), getAllAvatarIds());
            if (gone.tags || gone.favorites || gone.recent) {
                console.log('[persona-manager] 페르소나 삭제 후 정리', gone);
                store.save();
            }
            refreshAll();
        });

        eventSource.on(event_types.APP_READY, () => {
            injectIntoOriginalTab();
            updateFaceButton();
        });

        console.log('[persona-manager] 준비 완료');
    } catch (err) {
        console.error('[persona-manager] 초기화 실패', err);
    }
});
