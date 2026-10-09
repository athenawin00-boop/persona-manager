/**
 * ST 원래 페르소나 탭에 끼워넣기.
 *
 * ① 검색창(#persona_search_bar) 줄 아래에 태그 칩 줄 → 원래 목록을 필터
 * ② 오른쪽 현재 페르소나 이름(#your_name) 옆에 ⭐ 토글 + 태그 칩/＋
 *
 * 필터는 ST 자신의 FilterHelper(personasFilter)에 필터 함수를 한 개 얹는 방식이다.
 * 목록을 눈으로 숨기는 게 아니라 ST의 필터 파이프라인에 참여하므로
 * 페이지네이션 개수·검색 정렬이 전부 ST 기준으로 맞고, 재렌더 후에도 유지된다.
 * (filters.js의 applyFilters가 Object.values(this.filterFunctions)를 돌린다)
 *
 * 전부 try/catch로 감싼다 — 끼워넣기가 실패해도 원래 탭은 멀쩡해야 한다.
 */

import { personasFilter } from '../../../../personas.js';
import { power_user } from '../../../../power-user.js';
import { getCurrentAvatarId, openOriginalTab, rerenderOriginalList } from './st-bridge.js';
import {
    addTagToPersona, createTag, deleteTag, getPersonaTags,
    removeTagFromPersona, renameTag, setTagColor, toggleFavorite, isFavorite,
} from './settings.js';
import { tagChip, plainChip, openTagMenu } from './ui-parts.js';

/** personasFilter에 얹을 우리 필터 키. ST의 FILTER_TYPES와 겹치지 않는 이름. */
const PM_FILTER_KEY = 'pmPersonaManagerTag';

const CHIPS_ID = 'pm_tab_chips';
const CURRENT_ID = 'pm_tab_current';

let store = null;
let installed = false;
/** @type {'all'|'fav'|string} 'all' | 'fav' | 태그 id */
let tabScope = 'all';

/**
 * @param {object} deps
 * @param {object} deps.store {get, save}
 */
export function initTabInject(deps) {
    store = deps.store;
}

/**
 * ST 필터 파이프라인에 우리 필터를 얹는다. 멱등.
 * @returns {boolean} 성공 여부
 */
function installFilter() {
    if (installed) return true;
    try {
        if (!personasFilter || typeof personasFilter.applyFilters !== 'function') return false;

        personasFilter.filterData[PM_FILTER_KEY] = 'all';
        personasFilter.filterFunctions[PM_FILTER_KEY] = (data) => {
            const value = personasFilter.filterData[PM_FILTER_KEY];
            if (!value || value === 'all') return data;

            const settings = store.get();
            if (value === 'fav') {
                return data.filter(id => settings.favorites.includes(id));
            }
            return data.filter(id => (settings.personaTags[id] ?? []).includes(value));
        };
        installed = true;
        return true;
    } catch (err) {
        console.error('[persona-manager] 원래 탭 필터 설치 실패', err);
        return false;
    }
}

/** 우리 필터를 꺼낸다(확장 비활성 대비). */
export function uninstallFilter() {
    try {
        if (!installed) return;
        delete personasFilter.filterFunctions[PM_FILTER_KEY];
        delete personasFilter.filterData[PM_FILTER_KEY];
        installed = false;
    } catch { /* 무시 */ }
}

function setScope(next) {
    tabScope = next;
    try {
        // setFilterData가 값이 바뀐 경우에만 onDataChanged(=디바운스된 getUserAvatars)를 부른다
        personasFilter.setFilterData(PM_FILTER_KEY, next);
    } catch (err) {
        console.error('[persona-manager] 필터 적용 실패', err);
    }
    renderChips();
}

/**
 * 관리 화면의 '원래 탭에서 열기' 종점.
 *
 * ST 원래 페르소나 서랍을 열고 그 페르소나를 보이게 한다.
 * 우리 칩 필터가 켜져 있으면 그 페르소나가 목록에서 걸러져 있을 수 있다 —
 * 서랍만 열면 "열었는데 없다"가 되므로 먼저 범위를 푼다.
 * 현재 페르소나는 바꾸지 않는다(위치 이동·강조까지만).
 *
 * @param {string} avatarId
 * @returns {Promise<boolean>} 목록에서 실제로 찾았는지
 */
export async function revealInOriginalTab(avatarId) {
    try {
        const settings = store.get();
        const hidden = tabScope === 'fav'
            ? !settings.favorites.includes(avatarId)
            : tabScope !== 'all' && !(settings.personaTags[avatarId] ?? []).includes(tabScope);
        if (hidden) setScope('all');
    } catch (err) {
        console.error('[persona-manager] 원래 탭 범위 풀기 실패', err);
    }
    return await openOriginalTab(avatarId);
}

/** 칩 줄을 다시 그린다. */
export function renderChips() {
    try {
        const host = document.querySelector(`#${CHIPS_ID}`);
        if (!host) return;
        const settings = store.get();
        host.textContent = '';

        host.append(plainChip('전체', { on: tabScope === 'all', onClick: () => setScope('all') }));
        host.append(plainChip('★ 즐겨찾기', { on: tabScope === 'fav', onClick: () => setScope('fav') }));

        for (const tag of settings.tags) {
            host.append(tagChip(tag, {
                on: tabScope === tag.id,
                onClick: (id) => setScope(tabScope === id ? 'all' : id),
            }));
        }

        if (!settings.tags.length) {
            const hint = document.createElement('span');
            hint.className = 'pm-hint';
            hint.textContent = '태그는 페르소나 매니저 관리 화면에서 만들 수 있어요.';
            host.append(hint);
        }
    } catch (err) {
        console.error('[persona-manager] 칩 줄 렌더 실패', err);
    }
}

/** 현재 페르소나 줄(⭐ + 태그)을 다시 그린다. */
export function renderCurrentRow() {
    try {
        const host = document.querySelector(`#${CURRENT_ID}`);
        if (!host) return;

        const settings = store.get();
        const avatarId = getCurrentAvatarId();
        host.textContent = '';
        if (!avatarId || !power_user.personas?.[avatarId]) return;

        const star = document.createElement('span');
        star.className = 'pm-tab-star' + (isFavorite(settings, avatarId) ? ' pm-on' : '');
        star.id = 'pm_tab_star';
        star.textContent = '★';
        star.title = '즐겨찾기에 넣기 / 빼기';
        star.addEventListener('click', () => {
            toggleFavorite(settings, avatarId);
            store.save();
            renderCurrentRow();
            if (tabScope === 'fav') rerenderOriginalList(avatarId);
        });
        host.append(star);

        const chips = document.createElement('span');
        chips.className = 'pm-chips pm-chips-inline';
        for (const tid of getPersonaTags(settings, avatarId)) {
            const tag = settings.tags.find(t => t.id === tid);
            if (!tag) continue;
            chips.append(tagChip(tag, {
                removable: true,
                onRemove: (id) => {
                    removeTagFromPersona(settings, avatarId, id);
                    store.save();
                    renderCurrentRow();
                },
            }));
        }

        const add = plainChip('＋', { dashed: true, title: '이 페르소나에 태그 달기' });
        add.addEventListener('click', () => {
            openTagMenu(add, settings, {
                activeIds: getPersonaTags(settings, avatarId),
                allowManage: true,
                onPick: (id) => {
                    if (!addTagToPersona(settings, avatarId, id)) removeTagFromPersona(settings, avatarId, id);
                    store.save();
                    renderCurrentRow();
                    renderChips();
                },
                onCreate: (name) => {
                    const { tag } = createTag(settings, name);
                    if (tag) addTagToPersona(settings, avatarId, tag.id);
                    store.save();
                    renderCurrentRow();
                    renderChips();
                },
                onManage: (id, action, value) => {
                    if (action === 'color') setTagColor(settings, id, value);
                    if (action === 'rename') {
                        const tag = settings.tags.find(t => t.id === id);
                        const next = globalThis.prompt('새 태그 이름을 적어 주세요.', tag?.name ?? '');
                        if (next === null || !renameTag(settings, id, next)) return;
                    }
                    if (action === 'delete') {
                        const tag = settings.tags.find(t => t.id === id);
                        if (!globalThis.confirm(`태그 "${tag?.name ?? id}"를 지울까요? 이 태그가 달린 페르소나에서도 함께 떨어져요.`)) return;
                        deleteTag(settings, id);
                        if (tabScope === id) setScope('all');
                    }
                    store.save();
                    renderCurrentRow();
                    renderChips();
                },
            });
        });
        chips.append(add);
        host.append(chips);
    } catch (err) {
        console.error('[persona-manager] 현재 페르소나 줄 렌더 실패', err);
    }
}

/**
 * 원래 탭에 DOM을 끼워넣는다. 멱등 — 이미 있으면 다시 그리기만 한다.
 * @returns {boolean} 성공 여부
 */
export function injectIntoOriginalTab() {
    try {
        const searchBar = document.querySelector('#persona_search_bar');
        const avatarBlock = document.querySelector('#user_avatar_block');
        if (!searchBar || !avatarBlock) return false;

        if (!document.querySelector(`#${CHIPS_ID}`)) {
            const chips = document.createElement('div');
            chips.id = CHIPS_ID;
            chips.className = 'pm-chips pm-tab-chips';
            avatarBlock.parentElement.insertBefore(chips, avatarBlock);
        }

        const nameEl = document.querySelector('#your_name');
        if (nameEl && !document.querySelector(`#${CURRENT_ID}`)) {
            const row = document.createElement('span');
            row.id = CURRENT_ID;
            row.className = 'pm-tab-current';
            nameEl.after(row);
        }

        installFilter();
        renderChips();
        renderCurrentRow();
        return true;
    } catch (err) {
        console.error('[persona-manager] 원래 탭 끼워넣기 실패 — 원래 탭은 그대로 둡니다', err);
        return false;
    }
}

/**
 * ST가 목록을 다시 그려도 우리 DOM이 살아 있는지 확인하고 되살린다.
 * 이벤트 하나를 믿지 않는다 — 관찰자가 정답이고 이벤트는 보험이다.
 */
export function watchOriginalTab() {
    try {
        const block = document.querySelector('#user_avatar_block');
        if (!block) return;
        const observer = new MutationObserver(() => {
            if (!document.querySelector(`#${CHIPS_ID}`) || !document.querySelector(`#${CURRENT_ID}`)) {
                injectIntoOriginalTab();
            }
        });
        observer.observe(block, { childList: true });
    } catch (err) {
        console.error('[persona-manager] 원래 탭 관찰 실패', err);
    }
}
