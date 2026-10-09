/**
 * 전환창·관리 화면·원래 탭이 같이 쓰는 작은 DOM 조각들.
 */

import { getPersonaTags } from './settings.js';
import { wireAvatarImage } from './st-bridge.js';

/**
 * 태그 칩 하나.
 * @param {object} tag {id,name,color}
 * @param {object} [opts]
 * @param {boolean} [opts.on] 선택 상태
 * @param {boolean} [opts.removable] ✕ 표시
 * @param {function} [opts.onClick]
 * @param {function} [opts.onRemove]
 * @returns {HTMLElement}
 */
export function tagChip(tag, opts = {}) {
    const el = document.createElement('span');
    el.className = 'pm-chip' + (opts.on ? ' pm-chip-on' : '');
    el.dataset.tagId = tag.id;

    const dot = document.createElement('i');
    dot.className = 'pm-chip-dot';
    dot.style.background = tag.color;
    el.append(dot, document.createTextNode(tag.name));

    if (opts.removable) {
        const x = document.createElement('span');
        x.className = 'pm-chip-x';
        x.textContent = '✕';
        x.title = '이 태그 떼기';
        x.addEventListener('click', (e) => {
            e.stopPropagation();
            opts.onRemove?.(tag.id);
        });
        el.append(x);
    }

    if (opts.onClick) {
        el.classList.add('pm-clickable');
        el.addEventListener('click', () => opts.onClick(tag.id));
    }
    return el;
}

/**
 * 밋밋한 버튼형 칩(전체 / ★ 즐겨찾기 / ＋ 태그 등).
 * @returns {HTMLElement}
 */
export function plainChip(label, opts = {}) {
    const el = document.createElement('span');
    el.className = 'pm-chip' + (opts.on ? ' pm-chip-on' : '') + (opts.dashed ? ' pm-chip-dashed' : '');
    el.textContent = label;
    if (opts.title) el.title = opts.title;
    if (opts.onClick) {
        el.classList.add('pm-clickable');
        el.addEventListener('click', opts.onClick);
    }
    return el;
}

/**
 * 얼굴 카드 하나.
 *
 * @param {object} entry st-bridge.buildEntries가 만든 엔트리
 * @param {object} settings
 * @param {object} opts
 * @param {string} opts.currentId 현재 사용 중 avatarId
 * @param {boolean} [opts.focused] 방향키 포커스
 * @param {boolean} [opts.picked] 다중 선택됨
 * @param {boolean} [opts.selectable] 모서리에 다중 선택 체크를 단다
 * @param {function} [opts.onTogglePick] (entry) => void — 체크를 눌렀을 때
 * @param {function} [opts.onToggleFavorite] (entry) => void — ★을 눌렀을 때(주면 ★이 항상 보인다)
 * @param {function} [opts.onClick]
 * @param {function} [opts.onDblClick]
 * @returns {HTMLElement}
 */
export function personaCard(entry, settings, opts = {}) {
    const card = document.createElement('div');
    card.className = 'pm-card';
    card.dataset.avatarId = entry.avatarId;
    card.title = `${entry.name}\n${entry.avatarId}`;
    if (entry.avatarId === opts.currentId) card.classList.add('pm-current');
    if (opts.focused) card.classList.add('pm-focused');
    if (opts.picked) card.classList.add('pm-picked');
    // 체크가 왼쪽 위를 차지하면 '사용 중' 딱지·태그 점이 그 아래 깔린다 — CSS가 옆으로 민다
    if (opts.selectable) card.classList.add('pm-has-pick');

    const img = document.createElement('img');
    wireAvatarImage(img, entry.avatarId);
    card.append(img);

    if (opts.selectable) {
        const pick = document.createElement('span');
        pick.className = 'pm-card-pick' + (opts.picked ? ' pm-on' : '');
        pick.textContent = opts.picked ? '☑' : '☐';
        pick.title = '여러 개 고르기';
        pick.addEventListener('click', (e) => {
            // 카드 클릭은 세부창 열기다 — 체크는 거기까지 올라가면 안 된다
            e.stopPropagation();
            opts.onTogglePick?.(entry, e);
        });
        card.append(pick);
    }

    if (entry.avatarId === opts.currentId) {
        const badge = document.createElement('span');
        badge.className = 'pm-card-badge';
        badge.textContent = '사용 중';
        card.append(badge);
    } else if (opts.picked && !opts.selectable) {
        const ck = document.createElement('span');
        ck.className = 'pm-card-check';
        ck.textContent = '✓';
        card.append(ck);
    } else {
        const ids = getPersonaTags(settings, entry.avatarId);
        if (ids.length) {
            const dots = document.createElement('div');
            dots.className = 'pm-card-dots';
            for (const tid of ids) {
                const tag = settings.tags.find(t => t.id === tid);
                if (!tag) continue;
                const d = document.createElement('i');
                d.style.background = tag.color;
                d.title = tag.name;
                dots.append(d);
            }
            card.append(dots);
        }
    }

    // 끄기도 돼야 하므로 콜백이 있으면 꺼진 ★도 그린다(흐리게). 콜백이 없으면 예전처럼 켜졌을 때만.
    if (opts.onToggleFavorite || entry.favorite) {
        const star = document.createElement('span');
        star.className = 'pm-card-star' + (entry.favorite ? ' pm-on' : '');
        star.textContent = '★';
        if (opts.onToggleFavorite) {
            star.classList.add('pm-clickable');
            star.title = entry.favorite ? '즐겨찾기에서 빼기' : '즐겨찾기에 넣기';
            star.addEventListener('click', (e) => {
                // 카드 클릭이 전환·세부창이라 ★은 여기서 멈춘다
                e.stopPropagation();
                opts.onToggleFavorite(entry, e);
            });
        }
        card.append(star);
    }

    const nm = document.createElement('div');
    nm.className = 'pm-card-name';
    nm.textContent = entry.name;
    card.append(nm);

    if (opts.onClick) card.addEventListener('click', (e) => opts.onClick(entry, e));
    if (opts.onDblClick) card.addEventListener('dblclick', (e) => opts.onDblClick(entry, e));

    return card;
}

/**
 * 섹션 제목줄(★ 즐겨찾기 / 최근 5 / 전체 77).
 * @returns {HTMLElement}
 */
export function sectionLabel(text) {
    const el = document.createElement('div');
    el.className = 'pm-section';
    el.textContent = text;
    return el;
}

/**
 * 비어 있을 때 안내.
 * @returns {HTMLElement}
 */
export function emptyNote(text) {
    const el = document.createElement('div');
    el.className = 'pm-empty';
    el.textContent = text;
    return el;
}

/**
 * 태그 이름을 물어 새 태그를 만들거나 기존 태그를 고르는 작은 메뉴를 띄운다.
 * ST 팝업을 쓰지 않고 가벼운 드롭다운으로 — 창 위에 떠야 해서.
 *
 * @param {HTMLElement} anchor 기준 엘리먼트
 * @param {object} settings
 * @param {object} opts
 * @param {string[]} [opts.activeIds] 이미 달린 태그(체크 표시)
 * @param {function} opts.onPick (tagId) => void
 * @param {function} opts.onCreate (name) => void
 * @param {boolean} [opts.allowManage] 이름변경·색·삭제 줄 표시
 * @param {function} [opts.onManage] (tagId, action) => void
 */
export function openTagMenu(anchor, settings, opts) {
    document.querySelectorAll('.pm-tagmenu').forEach(el => el.remove());

    const menu = document.createElement('div');
    menu.className = 'pm-tagmenu';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pm-tagmenu-input';
    input.placeholder = '새 태그 이름 + Enter';
    menu.append(input);

    const list = document.createElement('div');
    list.className = 'pm-tagmenu-list';
    menu.append(list);

    const renderList = (q = '') => {
        list.textContent = '';
        const needle = q.trim().toLowerCase();
        const shown = settings.tags.filter(t => !needle || t.name.toLowerCase().includes(needle));
        if (!shown.length) {
            const note = document.createElement('div');
            note.className = 'pm-tagmenu-empty';
            note.textContent = needle ? 'Enter를 누르면 새 태그로 만들어요' : '아직 태그가 없어요';
            list.append(note);
            return;
        }
        for (const tag of shown) {
            const row = document.createElement('div');
            row.className = 'pm-tagmenu-row';

            const dot = document.createElement('i');
            dot.className = 'pm-chip-dot';
            dot.style.background = tag.color;

            const nameEl = document.createElement('span');
            nameEl.className = 'pm-tagmenu-name';
            nameEl.textContent = tag.name;

            const mark = document.createElement('span');
            mark.className = 'pm-tagmenu-mark';
            mark.textContent = (opts.activeIds ?? []).includes(tag.id) ? '✓' : '';

            row.append(dot, nameEl, mark);
            row.addEventListener('click', () => {
                opts.onPick?.(tag.id);
                menu.remove();
            });

            if (opts.allowManage) {
                const tools = document.createElement('span');
                tools.className = 'pm-tagmenu-tools pm-nodrag';

                const colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.value = tag.color;
                colorInput.title = '색 바꾸기';
                colorInput.addEventListener('click', e => e.stopPropagation());
                colorInput.addEventListener('change', (e) => {
                    e.stopPropagation();
                    opts.onManage?.(tag.id, 'color', colorInput.value);
                    dot.style.background = colorInput.value;
                });

                const ren = document.createElement('i');
                ren.className = 'fa-solid fa-pencil';
                ren.title = '이름 바꾸기';
                ren.addEventListener('click', (e) => {
                    e.stopPropagation();
                    opts.onManage?.(tag.id, 'rename');
                    menu.remove();
                });

                const del = document.createElement('i');
                del.className = 'fa-solid fa-trash';
                del.title = '태그 지우기';
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    opts.onManage?.(tag.id, 'delete');
                    menu.remove();
                });

                tools.append(colorInput, ren, del);
                row.append(tools);
            }

            list.append(row);
        }
    };
    renderList();

    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            const name = input.value.trim();
            if (name) {
                opts.onCreate?.(name);
                menu.remove();
            }
        } else if (e.key === 'Escape') {
            menu.remove();
        }
    });

    document.body.append(menu);

    // 화면 밖으로 나가지 않게 네 변을 전부 가둔다.
    // 예전엔 왼쪽 하한이 없어 폰에서 오른쪽 칩을 누르면 left 가 음수로 나가 메뉴가 잘렸다.
    const rect = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - mw - 8));
    const wantTop = rect.bottom + mh + 8 > window.innerHeight ? rect.top - mh - 4 : rect.bottom + 4;
    const top = Math.max(8, Math.min(wantTop, window.innerHeight - mh - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    setTimeout(() => {
        const away = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('pointerdown', away, true);
            }
        };
        document.addEventListener('pointerdown', away, true);
        input.focus();
    }, 0);

    return menu;
}
