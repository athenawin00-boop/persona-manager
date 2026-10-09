/**
 * 검색·태그 교집합·정리용 조건 필터 — 순수 로직.
 *
 * 입력 엔트리 모양(st-bridge.js가 만든다):
 *   { avatarId, name, description, lorebook, hasImage, tagIds, favorite, recentIndex }
 *
 * ST 배관을 부르지 않는다. logic-harness로 잘라내 단독 실행된다.
 */

/**
 * 대소문자·앞뒤 공백을 무시한 부분 일치.
 * @param {string} haystack
 * @param {string} needle 이미 소문자로 정규화된 질의
 * @returns {boolean}
 */
export function looseIncludes(haystack, needle) {
    if (!needle) return true;
    return String(haystack ?? '').toLowerCase().includes(needle);
}

/**
 * 정리용 조건 한 개 판정.
 * @param {object} entry
 * @param {string} special 'untagged' | 'nodesc' | 'lorebook' | 'noimage'
 * @returns {boolean}
 */
export function matchesSpecial(entry, special) {
    switch (special) {
        case 'untagged':
            return (entry.tagIds?.length ?? 0) === 0;
        case 'nodesc':
            return !String(entry.description ?? '').trim();
        case 'lorebook':
            return !!String(entry.lorebook ?? '').trim();
        case 'noimage':
            return entry.hasImage === false;
        default:
            return true;
    }
}

/**
 * 선택된 태그 칩 전부를 가진 엔트리만 통과(교집합).
 * 빈 선택은 통과.
 * @param {object} entry
 * @param {string[]} tagIds
 * @returns {boolean}
 */
export function matchesAllTags(entry, tagIds) {
    if (!Array.isArray(tagIds) || tagIds.length === 0) return true;
    const own = entry.tagIds ?? [];
    return tagIds.every(id => own.includes(id));
}

/**
 * 검색어 일치: 이름 또는 달린 태그 이름 중 하나라도 걸리면 통과.
 * @param {object} entry
 * @param {string} query 원본 질의(여기서 정규화한다)
 * @param {Object.<string,string>} tagNameById
 * @returns {boolean}
 */
export function matchesQuery(entry, query, tagNameById) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return true;

    if (looseIncludes(entry.name, q)) return true;

    for (const tid of (entry.tagIds ?? [])) {
        if (looseIncludes(tagNameById?.[tid], q)) return true;
    }
    return false;
}

/**
 * 전체 필터 파이프라인.
 *
 * @param {object[]} entries
 * @param {object} criteria
 * @param {string} [criteria.query] 검색어
 * @param {string[]} [criteria.tagIds] 교집합으로 걸 태그 id들
 * @param {string} [criteria.scope] 'all' | 'favorites' | 'recent' | 'tag:<id>' | 'special:<key>'
 * @param {Object.<string,string>} [criteria.tagNameById]
 * @returns {object[]} 통과한 엔트리(입력 순서 유지)
 */
export function filterPersonas(entries, criteria = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const { query = '', tagIds = [], scope = 'all', tagNameById = {} } = criteria;

    return list.filter((entry) => {
        // 사이드바 범위
        if (scope === 'favorites' && !entry.favorite) return false;
        if (scope === 'recent' && !(typeof entry.recentIndex === 'number' && entry.recentIndex >= 0)) return false;
        if (scope.startsWith('tag:')) {
            const id = scope.slice(4);
            if (!(entry.tagIds ?? []).includes(id)) return false;
        }
        if (scope.startsWith('special:')) {
            if (!matchesSpecial(entry, scope.slice(8))) return false;
        }

        // 칩 교집합
        if (!matchesAllTags(entry, tagIds)) return false;

        // 검색어
        if (!matchesQuery(entry, query, tagNameById)) return false;

        return true;
    });
}

/**
 * 최근 목록 순서로 정렬(최근 범위에서만 쓴다). recentIndex가 작을수록 앞.
 * @param {object[]} entries
 * @returns {object[]} 새 배열
 */
export function sortByRecent(entries) {
    return entries.slice().sort((a, b) => (a.recentIndex ?? 999) - (b.recentIndex ?? 999));
}

/**
 * 이름 오름차순 정렬(대소문자 무시).
 * @param {object[]} entries
 * @returns {object[]} 새 배열
 */
export function sortByName(entries) {
    return entries.slice().sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }));
}
