/**
 * 빠른 전환창 — 입력창 옆 얼굴 버튼으로 열린다.
 *
 * 검색(이름+태그) · 태그 칩 교집합 · 즐겨찾기/최근/전체 · 카드마다 ★ 토글 · 방향키·Enter·Esc.
 */

import { createFloatingWindow, isCoarsePointer, isNarrowScreen } from './window.js';
import { filterPersonas, sortByRecent } from './filters.js';
import { buildEntries, getCurrentAvatarId, switchPersona } from './st-bridge.js';
import { toggleFavorite } from './settings.js';
import { personaCard, sectionLabel, tagChip, plainChip, emptyNote } from './ui-parts.js';

const WINDOW_ID = 'pm_switch_window';

let win = null;
let store = null;          // { get(), save() }
let openManager = null;    // 관리 화면 열기 콜백

let query = '';
let pickedTags = [];
let focusIndex = 0;
let flatOrder = [];        // 방향키가 도는 순서(avatarId 배열)
let columns = 8;

/** 한 줄에 몇 칸 — 폰에선 6칸이 48px 카드를 만들어 이름이 "Me…"로 잘렸다(실측). */
function gridColumns() {
    return isNarrowScreen() ? 4 : 6;
}

/**
 * @param {object} deps
 * @param {object} deps.store {get, save}
 * @param {function} deps.openManager
 */
export function initSwitcher(deps) {
    store = deps.store;
    openManager = deps.openManager;
}

/** 전환창을 연다(없으면 만든다). */
export function openSwitcher() {
    if (!win) win = buildWindow();
    query = '';
    pickedTags = [];
    focusIndex = 0;
    win.open();
    render();
    const input = win.body.querySelector('#pm_switch_search');
    input && (input.value = '');
    // 폰에선 포커스를 주면 소프트 키보드가 올라와 카드를 절반 가린다 — 마우스일 때만 준다
    if (!isCoarsePointer()) input?.focus();
}

/** 전환창이 열려 있으면 다시 그린다(페르소나 변경·태그 변경 반영). */
export function refreshSwitcher() {
    if (win?.isOpen()) render();
}

/** 열려 있으면 닫고, 아니면 연다. */
export function toggleSwitcher() {
    if (win?.isOpen()) win.close();
    else openSwitcher();
}

function buildWindow() {
    const w = createFloatingWindow({
        id: WINDOW_ID,
        title: '페르소나 바꾸기',
        icon: 'fa-solid fa-user',
        extraClass: 'pm-switch',
    });

    const search = document.createElement('div');
    search.className = 'pm-search pm-nodrag';
    search.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'pm_switch_search';
    input.placeholder = '이름이나 태그로 찾기…';
    input.autocomplete = 'off';
    search.append(input);

    const chips = document.createElement('div');
    chips.className = 'pm-chips';
    chips.id = 'pm_switch_chips';

    const body = document.createElement('div');
    body.className = 'pm-switch-body';
    body.id = 'pm_switch_list';

    const foot = document.createElement('div');
    foot.className = 'pm-foot';
    // 터치 기기엔 통째로 숨긴다(style.css 의 @media (pointer: coarse)) — 링크는 바깥에 남긴다
    foot.innerHTML = '<span class="pm-foot-keys"><span>←→↑↓ 고르기</span><span>Enter 바꾸기</span><span>Esc 닫기</span></span>';
    const link = document.createElement('span');
    link.className = 'pm-foot-link pm-clickable';
    link.id = 'pm_switch_to_manage';
    link.textContent = '관리 화면 열기 ↗';
    link.addEventListener('click', () => {
        w.close();
        openManager?.();
    });
    foot.append(link);

    w.body.append(search, chips, body, foot);

    input.addEventListener('input', () => {
        query = input.value;
        focusIndex = 0;
        render();
    });

    w.root.addEventListener('keydown', onKeyDown);

    return w;
}

function onKeyDown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        win.close();
        return;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        const id = flatOrder[focusIndex];
        if (id) {
            win.close();
            switchPersona(id);
        }
        return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[e.key];
    if (step === undefined) return;

    e.preventDefault();
    const next = focusIndex + step;
    if (next < 0 || next >= flatOrder.length) return;
    focusIndex = next;
    paintFocus();
}

function paintFocus() {
    const list = win.body.querySelector('#pm_switch_list');
    list?.querySelectorAll('.pm-card.pm-focused').forEach(el => el.classList.remove('pm-focused'));
    const id = flatOrder[focusIndex];
    if (!id) return;
    const el = list?.querySelector(`.pm-card[data-avatar-id="${CSS.escape(id)}"]`);
    if (el) {
        el.classList.add('pm-focused');
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

function render() {
    if (!win) return;
    const settings = store.get();
    const currentId = getCurrentAvatarId();
    const entries = buildEntries(settings);
    const tagNameById = Object.fromEntries(settings.tags.map(t => [t.id, t.name]));

    // 태그 칩 줄
    const chips = win.body.querySelector('#pm_switch_chips');
    chips.textContent = '';
    for (const tag of settings.tags) {
        chips.append(tagChip(tag, {
            on: pickedTags.includes(tag.id),
            onClick: (id) => {
                const i = pickedTags.indexOf(id);
                i >= 0 ? pickedTags.splice(i, 1) : pickedTags.push(id);
                focusIndex = 0;
                render();
            },
        }));
    }
    if (pickedTags.length) {
        chips.append(plainChip('칩 해제', {
            dashed: true,
            onClick: () => { pickedTags = []; focusIndex = 0; render(); },
        }));
    }
    if (!settings.tags.length) {
        const note = document.createElement('span');
        note.className = 'pm-hint';
        note.textContent = '관리 화면에서 태그를 만들면 여기에 나와요.';
        chips.append(note);
    }

    const matched = filterPersonas(entries, { query, tagIds: pickedTags, tagNameById });

    const list = win.body.querySelector('#pm_switch_list');
    list.textContent = '';
    flatOrder = [];

    const searching = !!query.trim() || pickedTags.length > 0;

    const addGrid = (items, cols) => {
        const grid = document.createElement('div');
        grid.className = 'pm-grid';
        grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        for (const entry of items) {
            flatOrder.push(entry.avatarId);
            grid.append(personaCard(entry, settings, {
                currentId,
                onClick: (en) => { win.close(); switchPersona(en.avatarId); },
                // ★은 stopPropagation 이라 카드 클릭(=전환)으로 번지지 않는다.
                // 다시 그리면 위의 '★ 즐겨찾기' 줄이 그 자리에서 바로 맞춰진다.
                onToggleFavorite: (en) => {
                    toggleFavorite(settings, en.avatarId);
                    store.save();
                    render();
                },
            }));
        }
        list.append(grid);
    };

    const cols = gridColumns();

    if (searching) {
        columns = cols;
        list.append(sectionLabel(`검색 결과 ${matched.length}`));
        if (!matched.length) list.append(emptyNote('맞는 페르소나가 없어요. 검색어나 태그를 바꿔 보세요.'));
        else addGrid(matched, columns);
    } else {
        const favs = matched.filter(e => e.favorite);
        const recents = sortByRecent(matched.filter(e => e.recentIndex >= 0));

        if (favs.length) {
            list.append(sectionLabel(`★ 즐겨찾기 ${favs.length}`));
            addGrid(favs, cols);
        }
        if (recents.length) {
            list.append(sectionLabel(`최근 ${recents.length}`));
            addGrid(recents, cols);
        }
        columns = cols;
        list.append(sectionLabel(`전체 ${matched.length}`));
        addGrid(matched, columns);
    }

    if (focusIndex >= flatOrder.length) focusIndex = 0;
    paintFocus();
}
