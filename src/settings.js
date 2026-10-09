/**
 * 설정 스토어 + 태그/즐겨찾기/최근 순수 로직.
 *
 * 이 파일의 export 함수는 ST 배관을 전혀 부르지 않는다 — logic-harness로 잘라내
 * 단독 실행할 수 있어야 한다. 저장(saveSettingsDebounced) 호출은 전부 호출부 책임.
 */

export const MODULE_NAME = 'persona_manager';
export const SETTINGS_VERSION = 1;
export const RECENT_MAX = 5;

/** 새 태그에 돌려 쓰는 기본 색상 팔레트 */
export const TAG_PALETTE = [
    '#7c5cbf', '#3f8f74', '#b8574a', '#4a7ab8', '#8f7a3f',
    '#b0609a', '#4f9ea8', '#a4713f', '#6b8f3f', '#8b5f8b',
];

/** 사이드바 '정리용' 조건 키 */
export const SPECIAL_FILTERS = ['untagged', 'nodesc', 'lorebook'];

/** 보기 모드 */
export const VIEW_MODES = ['list', 'small', 'large'];

/**
 * 기본 설정값. 매번 새 객체를 만든다 — 기본값 객체를 참조로 물려주면
 * 한 곳을 쓸 때 이웃 레코드까지 오염된다.
 * @returns {object}
 */
export function getDefaultSettings() {
    return {
        version: SETTINGS_VERSION,
        tags: [],
        personaTags: {},
        favorites: [],
        recent: [],
        viewMode: 'large',
        lastSidebar: 'all',
    };
}

/**
 * 결손·파손 키를 메운다. 업그레이드 첫 로드와 같은 경로다.
 * @param {any} raw 저장돼 있던 값(무엇이든)
 * @returns {object} 정상화된 설정 객체(새 객체가 아니라 raw를 고쳐서 돌려준다)
 */
export function normalizeSettings(raw) {
    const base = getDefaultSettings();
    const s = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

    if (typeof s.version !== 'number') s.version = base.version;
    if (!Array.isArray(s.tags)) s.tags = [];
    if (!s.personaTags || typeof s.personaTags !== 'object' || Array.isArray(s.personaTags)) s.personaTags = {};
    if (!Array.isArray(s.favorites)) s.favorites = [];
    if (!Array.isArray(s.recent)) s.recent = [];
    if (!VIEW_MODES.includes(s.viewMode)) s.viewMode = base.viewMode;
    if (typeof s.lastSidebar !== 'string') s.lastSidebar = base.lastSidebar;

    // 태그 레코드 정상화: id/name이 없는 항목은 버린다
    s.tags = s.tags.filter(t => t && typeof t === 'object' && typeof t.id === 'string' && t.id)
        .map((t, i) => ({
            id: t.id,
            name: typeof t.name === 'string' && t.name ? t.name : t.id,
            color: typeof t.color === 'string' && t.color ? t.color : TAG_PALETTE[i % TAG_PALETTE.length],
        }));

    // 페르소나별 태그 배열 정상화(문자열 배열 + 중복 제거)
    for (const key of Object.keys(s.personaTags)) {
        const arr = s.personaTags[key];
        if (!Array.isArray(arr)) {
            delete s.personaTags[key];
            continue;
        }
        const clean = [...new Set(arr.filter(x => typeof x === 'string' && x))];
        if (clean.length) s.personaTags[key] = clean;
        else delete s.personaTags[key];
    }

    s.favorites = [...new Set(s.favorites.filter(x => typeof x === 'string' && x))];
    s.recent = [...new Set(s.recent.filter(x => typeof x === 'string' && x))].slice(0, RECENT_MAX);

    return s;
}

/**
 * 기존 id와 겹치지 않는 새 태그 id를 만든다.
 * @param {string[]} existingIds
 * @returns {string}
 */
export function makeTagId(existingIds) {
    const taken = new Set(Array.isArray(existingIds) ? existingIds : []);
    let n = 1;
    while (taken.has(`t${n}`)) n++;
    return `t${n}`;
}

/**
 * 태그를 만든다. 같은 이름이 이미 있으면 그 태그를 돌려준다(중복 생성 방지).
 * @param {object} settings
 * @param {string} name
 * @param {string} [color]
 * @returns {{tag: object, created: boolean}}
 */
export function createTag(settings, name, color) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return { tag: null, created: false };

    const existing = settings.tags.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return { tag: existing, created: false };

    const tag = {
        id: makeTagId(settings.tags.map(t => t.id)),
        name: trimmed,
        color: color || TAG_PALETTE[settings.tags.length % TAG_PALETTE.length],
    };
    settings.tags.push(tag);
    return { tag, created: true };
}

/**
 * 태그 이름을 바꾼다. 빈 이름이거나 다른 태그와 이름이 겹치면 거절한다.
 * @returns {boolean} 바뀌었는지
 */
export function renameTag(settings, tagId, newName) {
    const trimmed = String(newName ?? '').trim();
    if (!trimmed) return false;

    const tag = settings.tags.find(t => t.id === tagId);
    if (!tag) return false;

    const clash = settings.tags.find(t => t.id !== tagId && t.name.toLowerCase() === trimmed.toLowerCase());
    if (clash) return false;

    tag.name = trimmed;
    return true;
}

/** 태그 색을 바꾼다. @returns {boolean} */
export function setTagColor(settings, tagId, color) {
    const tag = settings.tags.find(t => t.id === tagId);
    if (!tag || !color) return false;
    tag.color = String(color);
    return true;
}

/**
 * 태그를 지우고 모든 페르소나에서 그 태그 참조를 뗀다.
 * @returns {number} 참조가 떨어진 페르소나 수
 */
export function deleteTag(settings, tagId) {
    const idx = settings.tags.findIndex(t => t.id === tagId);
    if (idx < 0) return 0;
    settings.tags.splice(idx, 1);

    let touched = 0;
    for (const key of Object.keys(settings.personaTags)) {
        const arr = settings.personaTags[key];
        const next = arr.filter(id => id !== tagId);
        if (next.length !== arr.length) {
            touched++;
            if (next.length) settings.personaTags[key] = next;
            else delete settings.personaTags[key];
        }
    }
    return touched;
}

/**
 * 페르소나에 달린 태그 id 배열(없으면 빈 배열, 새 배열을 돌려주지 않고 내부 참조를 숨긴다).
 * @returns {string[]}
 */
export function getPersonaTags(settings, avatarId) {
    const arr = settings.personaTags[avatarId];
    return Array.isArray(arr) ? arr.slice() : [];
}

/** @returns {boolean} 실제로 달렸는지 */
export function addTagToPersona(settings, avatarId, tagId) {
    if (!avatarId || !tagId) return false;
    if (!settings.tags.some(t => t.id === tagId)) return false;

    const arr = settings.personaTags[avatarId] ?? [];
    if (arr.includes(tagId)) return false;

    arr.push(tagId);
    settings.personaTags[avatarId] = arr;
    return true;
}

/** @returns {boolean} 실제로 떨어졌는지 */
export function removeTagFromPersona(settings, avatarId, tagId) {
    const arr = settings.personaTags[avatarId];
    if (!Array.isArray(arr)) return false;

    const next = arr.filter(id => id !== tagId);
    if (next.length === arr.length) return false;

    if (next.length) settings.personaTags[avatarId] = next;
    else delete settings.personaTags[avatarId];
    return true;
}

/** @returns {boolean} */
export function isFavorite(settings, avatarId) {
    return settings.favorites.includes(avatarId);
}

/**
 * 즐겨찾기 토글.
 * @returns {boolean} 토글 후 상태(true = 즐겨찾기)
 */
export function toggleFavorite(settings, avatarId) {
    const i = settings.favorites.indexOf(avatarId);
    if (i >= 0) {
        settings.favorites.splice(i, 1);
        return false;
    }
    settings.favorites.push(avatarId);
    return true;
}

/**
 * 즐겨찾기를 원하는 상태로 맞춘다(일괄 작업용).
 * @returns {boolean} 바뀌었는지
 */
export function setFavorite(settings, avatarId, desired) {
    const has = settings.favorites.includes(avatarId);
    if (has === !!desired) return false;
    toggleFavorite(settings, avatarId);
    return true;
}

/**
 * 최근 사용 목록 맨 앞에 올린다. 이미 있으면 끌어올리고, 상한을 넘으면 꼬리를 버린다.
 * @returns {string[]} 갱신된 recent 배열(같은 참조)
 */
export function pushRecent(settings, avatarId) {
    if (!avatarId) return settings.recent;

    const i = settings.recent.indexOf(avatarId);
    if (i >= 0) settings.recent.splice(i, 1);
    settings.recent.unshift(avatarId);
    if (settings.recent.length > RECENT_MAX) settings.recent.length = RECENT_MAX;
    return settings.recent;
}

/**
 * 없어진 페르소나가 남긴 고아 데이터를 치운다.
 * @param {object} settings
 * @param {string[]} existingIds 현재 실존하는 avatarId 목록
 * @returns {{tags: number, favorites: number, recent: number}} 지워진 개수
 */
export function cleanupOrphans(settings, existingIds) {
    const alive = new Set(Array.isArray(existingIds) ? existingIds : []);
    const removed = { tags: 0, favorites: 0, recent: 0 };

    for (const key of Object.keys(settings.personaTags)) {
        if (!alive.has(key)) {
            delete settings.personaTags[key];
            removed.tags++;
        }
    }

    const favBefore = settings.favorites.length;
    settings.favorites = settings.favorites.filter(id => alive.has(id));
    removed.favorites = favBefore - settings.favorites.length;

    const recBefore = settings.recent.length;
    settings.recent = settings.recent.filter(id => alive.has(id));
    removed.recent = recBefore - settings.recent.length;

    return removed;
}

/**
 * 태그별 페르소나 개수. 사이드바 카운트용.
 * @param {object} settings
 * @param {string[]} allIds
 * @returns {Object.<string, number>}
 */
export function countByTag(settings, allIds) {
    const out = {};
    for (const t of settings.tags) out[t.id] = 0;
    for (const id of allIds) {
        for (const tid of (settings.personaTags[id] ?? [])) {
            if (tid in out) out[tid]++;
        }
    }
    return out;
}
