/**
 * 관리 화면 — 요술봉 메뉴 '페르소나 매니저'로 열린다.
 *
 * 왼쪽 사이드바(범위) · 검색 · 보기 토글(목록/작게/크게) ·
 * 세 모드 모두 카드·행 클릭 → 세부창(오른쪽 편집 패널, 좁은 화면은 전체화면) ·
 * 다중 선택은 체크칸(목록)·모서리 체크(작게)로만 → 하단 바 일괄 태그/즐겨찾기.
 */

import { createFloatingWindow, isNarrowScreen } from './window.js';
import { filterPersonas, sortByName, sortByRecent } from './filters.js';
import {
    buildEntries, getCurrentAvatarId, switchPersona,
    renamePersonaSafe, setDescriptionSafe, wireAvatarImage,
} from './st-bridge.js';
import { revealInOriginalTab } from './tab-inject.js';
import {
    addTagToPersona, countByTag, createTag, deleteTag, getPersonaTags,
    removeTagFromPersona, renameTag, setFavorite, setTagColor, toggleFavorite,
} from './settings.js';
import { personaCard, tagChip, plainChip, emptyNote, openTagMenu } from './ui-parts.js';

const WINDOW_ID = 'pm_manage_window';

let win = null;
let store = null;
let openSwitcher = null;

let query = '';
let scope = 'all';
let picked = new Set();        // 다중 선택된 avatarId
let selectedId = null;         // 세부창(편집 패널) 대상

/**
 * @param {object} deps
 * @param {object} deps.store {get, save}
 * @param {function} [deps.openSwitcher]
 */
export function initManager(deps) {
    store = deps.store;
    openSwitcher = deps.openSwitcher;
}

/** 관리 화면을 연다. */
export function openManager() {
    if (!win) win = buildWindow();
    const settings = store.get();
    scope = settings.lastSidebar || 'all';
    picked.clear();
    win.open();
    render();
}

/** 열려 있으면 다시 그린다. */
export function refreshManager() {
    if (win?.isOpen()) render();
}

function buildWindow() {
    const w = createFloatingWindow({
        id: WINDOW_ID,
        title: '페르소나 관리',
        icon: 'fa-solid fa-user-gear',
        extraClass: 'pm-manage',
        collapsible: false,
    });

    // 제목줄: 검색 + 보기 토글
    const search = document.createElement('div');
    search.className = 'pm-search pm-search-sm pm-nodrag';
    search.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'pm_manage_search';
    input.placeholder = '찾기…';
    input.autocomplete = 'off';
    input.addEventListener('input', () => { query = input.value; render(); });
    search.append(input);

    const seg = document.createElement('div');
    seg.className = 'pm-seg pm-nodrag';
    seg.id = 'pm_manage_viewmode';
    for (const [mode, label] of [['list', '목록'], ['small', '작게'], ['large', '크게']]) {
        const b = document.createElement('span');
        b.dataset.mode = mode;
        b.textContent = label;
        b.addEventListener('click', () => {
            const s = store.get();
            s.viewMode = mode;
            store.save();
            picked.clear();
            render();
        });
        seg.append(b);
    }

    w.headerSlot.append(search, seg);

    const layout = document.createElement('div');
    layout.className = 'pm-manage-layout';
    layout.innerHTML =
        '<div class="pm-side" id="pm_manage_side"></div>' +
        '<div class="pm-main" id="pm_manage_main"></div>' +
        '<div class="pm-edit" id="pm_manage_edit"></div>';
    w.body.append(layout);

    const bulk = document.createElement('div');
    bulk.className = 'pm-bulk';
    bulk.id = 'pm_manage_bulk';
    bulk.style.display = 'none';
    w.body.append(bulk);

    return w;
}

/** 현재 보기 모드 */
function viewMode() {
    return store.get().viewMode;
}

function render() {
    if (!win) return;
    const settings = store.get();
    const currentId = getCurrentAvatarId();
    const entries = buildEntries(settings);
    const tagNameById = Object.fromEntries(settings.tags.map(t => [t.id, t.name]));
    const mode = viewMode();

    win.root.querySelectorAll('#pm_manage_viewmode span').forEach((el) => {
        el.classList.toggle('pm-on', el.dataset.mode === mode);
    });

    renderSidebar(settings, entries);

    let matched = filterPersonas(entries, { query, scope, tagNameById });
    matched = scope === 'recent' ? sortByRecent(matched) : sortByName(matched);

    renderMain(settings, matched, currentId, mode);
    renderEdit(settings, entries, currentId);
    renderBulk(settings);
}

function renderSidebar(settings, entries) {
    const side = win.root.querySelector('#pm_manage_side');
    side.textContent = '';

    const allIds = entries.map(e => e.avatarId);
    const counts = countByTag(settings, allIds);

    const item = (key, label, count, color) => {
        const row = document.createElement('div');
        row.className = 'pm-side-item' + (scope === key ? ' pm-on' : '');
        row.dataset.scope = key;
        if (color) {
            const dot = document.createElement('i');
            dot.style.background = color;
            row.append(dot);
        }
        const name = document.createElement('span');
        name.textContent = label;
        const num = document.createElement('b');
        num.textContent = String(count);
        row.append(name, num);
        row.addEventListener('click', () => {
            scope = key;
            const s = store.get();
            s.lastSidebar = key;
            store.save();
            picked.clear();
            render();
        });
        side.append(row);
        return row;
    };

    const head = (text) => {
        const h = document.createElement('h4');
        h.textContent = text;
        side.append(h);
    };

    item('all', '전체', entries.length);
    item('favorites', '★ 즐겨찾기', entries.filter(e => e.favorite).length);
    item('recent', '최근', entries.filter(e => e.recentIndex >= 0).length);

    head('태그');
    for (const tag of settings.tags) {
        const row = item(`tag:${tag.id}`, tag.name, counts[tag.id] ?? 0, tag.color);
        row.title = '⋯ 를 누르면 이름·색·삭제를 고를 수 있어요.';

        const openMenuAt = (anchor) => openTagMenu(anchor, settings, {
            activeIds: [],
            allowManage: true,
            onPick: (id) => { scope = `tag:${id}`; render(); },
            onCreate: (name) => { createTag(settings, name); store.save(); render(); },
            onManage: (id, action, value) => handleTagManage(settings, id, action, value),
        });

        // 폰엔 우클릭이 없다(iOS 길게 누르기로 contextmenu 가 안 뜰다) — 눈에 보이는 손잡이를 달아 둔다.
        // 우클릭도 그대로 살려 둔다.
        const dots = document.createElement('span');
        dots.className = 'pm-side-dots pm-clickable';
        dots.textContent = '⋯';
        dots.title = '이름 바꾸기 · 색 · 지우기';
        dots.addEventListener('click', (e) => {
            // 범위 전환까지 같이 일어나면 메뉴를 부른 순간 목록이 휘어 눈이 피로해진다
            e.stopPropagation();
            openMenuAt(dots);
        });
        row.append(dots);

        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            openMenuAt(row);
        });
    }
    const addRow = document.createElement('div');
    addRow.className = 'pm-side-item pm-side-add';
    addRow.textContent = '＋ 새 태그';
    addRow.addEventListener('click', () => {
        openTagMenu(addRow, store.get(), {
            allowManage: true,
            onPick: (id) => { scope = `tag:${id}`; render(); },
            onCreate: (name) => { createTag(store.get(), name); store.save(); render(); },
            onManage: (id, action, value) => handleTagManage(store.get(), id, action, value),
        });
    });
    side.append(addRow);

    head('정리용');
    item('special:untagged', '태그 없음', entries.filter(e => (e.tagIds?.length ?? 0) === 0).length);
    item('special:nodesc', '설명 빔', entries.filter(e => !String(e.description ?? '').trim()).length);
    item('special:lorebook', '로어북 붙음', entries.filter(e => !!String(e.lorebook ?? '').trim()).length);
}

function handleTagManage(settings, tagId, action, value) {
    if (action === 'color') {
        setTagColor(settings, tagId, value);
        store.save();
        render();
        return;
    }
    if (action === 'rename') {
        const tag = settings.tags.find(t => t.id === tagId);
        const next = globalThis.prompt('새 태그 이름을 적어 주세요.', tag?.name ?? '');
        if (next === null) return;
        if (!renameTag(settings, tagId, next)) {
            toastr.warning('같은 이름의 태그가 이미 있거나 이름이 비어 있어요.');
            return;
        }
        store.save();
        render();
        return;
    }
    if (action === 'delete') {
        const tag = settings.tags.find(t => t.id === tagId);
        if (!globalThis.confirm(`태그 "${tag?.name ?? tagId}"를 지울까요? 이 태그가 달린 페르소나에서도 함께 떨어져요.`)) return;
        deleteTag(settings, tagId);
        if (scope === `tag:${tagId}`) scope = 'all';
        store.save();
        render();
    }
}

/** 다중 선택 토글 — 체크칸·모서리 체크에서만 부른다. */
function togglePick(avatarId) {
    picked.has(avatarId) ? picked.delete(avatarId) : picked.add(avatarId);
    render();
}

/** 즐겨찾기 토글 — 카드·행의 ★에서 바로 부른다(세부창을 열지 않는다). */
function toggleFav(avatarId) {
    toggleFavorite(store.get(), avatarId);
    store.save();
    render();
}

function renderMain(settings, matched, currentId, mode) {
    const main = win.root.querySelector('#pm_manage_main');
    main.textContent = '';
    main.className = `pm-main pm-main-${mode}`;

    if (!matched.length) {
        main.append(emptyNote('여기에 해당하는 페르소나가 없어요.'));
        return;
    }

    if (mode === 'list') {
        for (const entry of matched) main.append(listRow(settings, entry, currentId));
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'pm-grid';
    grid.style.gridTemplateColumns = mode === 'small'
        ? 'repeat(auto-fill, minmax(92px, 1fr))'
        : 'repeat(auto-fill, minmax(150px, 1fr))';

    for (const entry of matched) {
        grid.append(personaCard(entry, settings, {
            currentId,
            // 카드 클릭은 세 모드 전부 세부창이다. 다중 선택은 '작게'의 모서리 체크가 따로 맡는다.
            selectable: mode === 'small',
            picked: picked.has(entry.avatarId),
            focused: entry.avatarId === selectedId,
            onTogglePick: (en) => togglePick(en.avatarId),
            onToggleFavorite: (en) => toggleFav(en.avatarId),
            onClick: (en) => {
                selectedId = en.avatarId;
                render();
            },
        }));
    }
    main.append(grid);
}

function listRow(settings, entry, currentId) {
    const row = document.createElement('div');
    row.className = 'pm-row';
    row.dataset.avatarId = entry.avatarId;
    if (picked.has(entry.avatarId)) row.classList.add('pm-picked');
    if (entry.avatarId === selectedId) row.classList.add('pm-focused');
    if (entry.avatarId === currentId) row.classList.add('pm-current');

    const box = document.createElement('span');
    box.className = 'pm-row-check pm-clickable';
    box.textContent = picked.has(entry.avatarId) ? '☑' : '☐';
    box.title = '여러 개 고르기';
    box.addEventListener('click', (e) => {
        // 행 클릭은 세부창 열기다 — 체크칸만 다중 선택을 맡는다
        e.stopPropagation();
        togglePick(entry.avatarId);
    });

    const star = document.createElement('span');
    star.className = 'pm-row-star pm-clickable' + (entry.favorite ? ' pm-on' : '');
    star.textContent = '★';
    star.title = entry.favorite ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기';
    star.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFav(entry.avatarId);
    });

    const img = document.createElement('img');
    wireAvatarImage(img, entry.avatarId);

    const name = document.createElement('b');
    name.className = 'pm-row-name';
    name.textContent = entry.name;

    const desc = document.createElement('span');
    desc.className = 'pm-row-desc';
    const text = String(entry.description ?? '').replace(/\s+/g, ' ').trim();
    if (text) desc.textContent = text;
    else {
        desc.textContent = '(설명 비어 있음)';
        desc.classList.add('pm-muted');
    }

    const tags = document.createElement('span');
    tags.className = 'pm-row-tags';
    for (const tid of getPersonaTags(settings, entry.avatarId)) {
        const tag = settings.tags.find(t => t.id === tid);
        if (tag) tags.append(tagChip(tag));
    }

    const lore = document.createElement('span');
    lore.className = 'pm-row-lore';
    lore.textContent = String(entry.lorebook ?? '').trim() ? '📖 로어북' : '';

    row.append(box, star, img, name, desc, tags, lore);
    row.addEventListener('click', () => {
        selectedId = entry.avatarId;
        render();
    });
    return row;
}

function renderEdit(settings, entries, currentId) {
    const panel = win.root.querySelector('#pm_manage_edit');
    panel.textContent = '';

    const entry = entries.find(e => e.avatarId === selectedId);
    const narrow = isNarrowScreen();
    // 데스크탑은 세 보기 모드 모두 오른쪽에 붙어 있고 비었을 땐 안내문을 보여준다.
    // 좁은 화면엔 이 패널이 목록 위를 덮는 전체 화면이라 고른 게 없으면 아예 띄우지 않는다.
    const show = !narrow || !!entry;
    panel.style.display = show ? '' : 'none';
    if (!show) return;

    if (!entry) {
        panel.append(emptyNote('카드나 행을 하나 누르면 여기서 이름과 설명을 고칠 수 있어요.'));
        return;
    }

    // 좁은 화면 전용 되돌아가기(CSS 가 데스크탑엔 display:none 으로 감춘다)
    const back = document.createElement('div');
    back.className = 'pm-btn pm-edit-back';
    back.id = 'pm_edit_back';
    back.textContent = '← 목록';
    back.addEventListener('click', () => {
        selectedId = null;
        render();
    });

    const img = document.createElement('img');
    img.className = 'pm-edit-face';
    wireAvatarImage(img, entry.avatarId);

    const starBtn = document.createElement('span');
    starBtn.className = 'pm-edit-star' + (entry.favorite ? ' pm-on' : '');
    starBtn.id = 'pm_edit_star';
    starBtn.textContent = '★';
    starBtn.title = '즐겨찾기';
    starBtn.addEventListener('click', () => toggleFav(entry.avatarId));

    const nameLabel = document.createElement('label');
    nameLabel.textContent = '이름';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'pm-fld';
    nameInput.id = 'pm_edit_name';
    nameInput.value = entry.name;
    const commitName = async () => {
        if (nameInput.value.trim() === entry.name) return;
        try {
            await renamePersonaSafe(entry.avatarId, nameInput.value);
        } catch (err) {
            console.error('[persona-manager] 이름 저장 실패', err);
            toastr.error('이름을 저장하지 못했어요. 콘솔을 확인해 주세요.');
            nameInput.value = entry.name;
        }
        render();
    };
    nameInput.addEventListener('blur', commitName);
    nameInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
    });

    const descLabel = document.createElement('label');
    descLabel.textContent = '설명';
    const descInput = document.createElement('textarea');
    descInput.className = 'pm-fld pm-edit-desc';
    descInput.id = 'pm_edit_desc';
    descInput.rows = 8;
    descInput.value = entry.description;
    const commitDesc = async () => {
        if (descInput.value === entry.description) return;
        try {
            await setDescriptionSafe(entry.avatarId, descInput.value);
            toastr.success('설명을 저장했어요.');
        } catch (err) {
            console.error('[persona-manager] 설명 저장 실패', err);
            toastr.error('설명을 저장하지 못했어요. 콘솔을 확인해 주세요.');
            descInput.value = entry.description;
        }
        render();
    };
    descInput.addEventListener('blur', commitDesc);
    descInput.addEventListener('keydown', e => e.stopPropagation());

    const tagLabel = document.createElement('label');
    tagLabel.textContent = '태그';
    const tagRow = document.createElement('div');
    tagRow.className = 'pm-chips';
    tagRow.id = 'pm_edit_tags';
    for (const tid of getPersonaTags(settings, entry.avatarId)) {
        const tag = settings.tags.find(t => t.id === tid);
        if (!tag) continue;
        tagRow.append(tagChip(tag, {
            removable: true,
            onRemove: (id) => {
                removeTagFromPersona(settings, entry.avatarId, id);
                store.save();
                render();
            },
        }));
    }
    const addChip = plainChip('＋', { dashed: true, title: '태그 달기' });
    addChip.addEventListener('click', () => {
        openTagMenu(addChip, settings, {
            activeIds: getPersonaTags(settings, entry.avatarId),
            allowManage: true,
            onPick: (id) => {
                if (!addTagToPersona(settings, entry.avatarId, id)) removeTagFromPersona(settings, entry.avatarId, id);
                store.save();
                render();
            },
            onCreate: (name) => {
                const { tag } = createTag(settings, name);
                if (tag) addTagToPersona(settings, entry.avatarId, tag.id);
                store.save();
                render();
            },
            onManage: (id, action, value) => handleTagManage(settings, id, action, value),
        });
    });
    tagRow.append(addChip);

    const buttons = document.createElement('div');
    buttons.className = 'pm-edit-buttons';

    const switchBtn = document.createElement('div');
    switchBtn.className = 'pm-btn pm-btn-primary';
    switchBtn.id = 'pm_edit_switch';
    switchBtn.textContent = '이 페르소나로 바꾸기';
    switchBtn.classList.toggle('pm-disabled', entry.avatarId === currentId);
    switchBtn.addEventListener('click', async () => {
        if (entry.avatarId === currentId) return;
        await switchPersona(entry.avatarId);
        render();
    });

    const openBtn = document.createElement('div');
    openBtn.className = 'pm-btn';
    openBtn.id = 'pm_edit_opentab';
    openBtn.textContent = '원래 탭에서 열기';
    openBtn.addEventListener('click', async () => {
        // 관리창이 위에 떠 있으면 서랍을 열어도 가려서 안 보인다 — 먼저 비켜 준다
        win.close();
        const found = await revealInOriginalTab(entry.avatarId);
        if (!found) toastr.info('원래 패널을 열었어요. 목록에서 바로 찾지는 못했어요.');
    });

    buttons.append(switchBtn, openBtn);

    const head = document.createElement('div');
    head.className = 'pm-edit-head';
    head.append(img, starBtn);

    panel.append(back, head, nameLabel, nameInput, descLabel, descInput, tagLabel, tagRow, buttons);
}

function renderBulk(settings) {
    const bar = win.root.querySelector('#pm_manage_bulk');
    bar.textContent = '';

    // 체크된 게 있을 때만 뜬다. 체크는 '목록'의 체크칸과 '작게'의 모서리 체크에서만 생긴다.
    if (picked.size === 0) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = '';

    const count = document.createElement('b');
    count.textContent = `${picked.size}개 선택됨`;

    const addBtn = document.createElement('span');
    addBtn.className = 'pm-btn';
    addBtn.id = 'pm_bulk_addtag';
    addBtn.textContent = '＋ 태그 달기';
    addBtn.addEventListener('click', () => {
        openTagMenu(addBtn, settings, {
            onPick: (id) => {
                for (const avatarId of picked) addTagToPersona(settings, avatarId, id);
                store.save();
                render();
            },
            onCreate: (name) => {
                const { tag } = createTag(settings, name);
                if (tag) for (const avatarId of picked) addTagToPersona(settings, avatarId, tag.id);
                store.save();
                render();
            },
        });
    });

    const delBtn = document.createElement('span');
    delBtn.className = 'pm-btn';
    delBtn.id = 'pm_bulk_removetag';
    delBtn.textContent = '－ 태그 빼기';
    delBtn.addEventListener('click', () => {
        openTagMenu(delBtn, settings, {
            onPick: (id) => {
                for (const avatarId of picked) removeTagFromPersona(settings, avatarId, id);
                store.save();
                render();
            },
            onCreate: () => { },
        });
    });

    const favBtn = document.createElement('span');
    favBtn.className = 'pm-btn';
    favBtn.id = 'pm_bulk_fav';
    const allFav = [...picked].every(id => settings.favorites.includes(id));
    favBtn.textContent = allFav ? '★ 즐겨찾기 빼기' : '★ 즐겨찾기';
    favBtn.addEventListener('click', () => {
        for (const avatarId of picked) setFavorite(settings, avatarId, !allFav);
        store.save();
        render();
    });

    const clear = document.createElement('span');
    clear.className = 'pm-bulk-clear pm-clickable';
    clear.id = 'pm_bulk_clear';
    clear.textContent = '선택 해제';
    clear.addEventListener('click', () => { picked.clear(); render(); });

    bar.append(count, addBtn, delBtn, favBtn, clear);
}

/** 전환창으로 가는 링크를 쓰는 쪽이 있으면 노출 */
export function getSwitcherOpener() {
    return openSwitcher;
}
