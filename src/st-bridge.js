/**
 * ST 배관 어댑터 — 페르소나 읽기/전환/편집을 전부 여기로 모은다.
 *
 * 원칙(발주 확정): 설정(power_user.personas / persona_descriptions)을 직접 쓰지 않는다.
 * 전환·개명·설명 수정은 ST 원래 함수나 원래 컨트롤 경유로만 한다 —
 * 직접 쓰면 ST 핸들러에 붙어 있는 파생 처리(저장·이벤트·목록 재렌더·토큰 카운트)가 통째로 빠진다.
 */

import {
    getThumbnailUrl,
    getUserAvatars,
    setUserAvatar,
    user_avatar,
} from '../../../../../script.js';
import { power_user } from '../../../../power-user.js';

/** 이미지가 없는 페르소나에 쓸 ST 기본 얼굴 */
export const DEFAULT_AVATAR_IMG = 'img/user-default.png';

/** 서버에서 확인한 실존 아바타 파일 목록 캐시 */
let avatarFileCache = null;

/** @returns {object} ST 컨텍스트 */
export function ctx() {
    return globalThis.SillyTavern.getContext();
}

/** @returns {string} 현재 페르소나 avatarId */
export function getCurrentAvatarId() {
    return user_avatar;
}

/** @returns {string} 썸네일 URL */
export function thumbUrl(avatarId) {
    return getThumbnailUrl('persona', avatarId);
}

/**
 * 서버의 실제 아바타 파일 목록을 받아 캐시한다.
 * 이미지 없는 페르소나(설정엔 있는데 파일이 없는 것)를 가르는 유일한 근거다.
 * @param {boolean} [force]
 * @returns {Promise<string[]>}
 */
export async function refreshAvatarFiles(force = false) {
    if (avatarFileCache && !force) return avatarFileCache;
    try {
        const list = await getUserAvatars(false);
        avatarFileCache = Array.isArray(list) ? list : [];
    } catch (err) {
        console.error('[persona-manager] 아바타 목록 조회 실패', err);
        avatarFileCache = avatarFileCache ?? [];
    }
    return avatarFileCache;
}

/** @returns {string[]} 캐시된 실존 파일 목록 */
export function getAvatarFiles() {
    return avatarFileCache ?? [];
}

/**
 * 설정에 등록된 모든 페르소나의 avatarId.
 * power_user.personas가 정본이다(파일은 있는데 등록이 안 된 건 ST가 addMissingPersonas로 채운다).
 * @returns {string[]}
 */
export function getAllAvatarIds() {
    return Object.keys(power_user.personas ?? {});
}

/** @returns {string} 표시용 이름 */
export function getPersonaName(avatarId) {
    return power_user.personas?.[avatarId] ?? '';
}

/** @returns {object} 설명자(없으면 빈 객체) */
export function getDescriptor(avatarId) {
    return power_user.persona_descriptions?.[avatarId] ?? {};
}

/**
 * 확장이 다루는 엔트리 배열을 만든다. filters.js가 먹는 모양.
 * @param {object} settings 확장 설정
 * @returns {object[]}
 */
export function buildEntries(settings) {
    const files = new Set(getAvatarFiles());
    const hasFileInfo = files.size > 0;

    return getAllAvatarIds().map((avatarId) => {
        const d = getDescriptor(avatarId);
        const recentIndex = settings.recent.indexOf(avatarId);
        return {
            avatarId,
            name: getPersonaName(avatarId) || '[이름 없음]',
            description: d.description ?? '',
            lorebook: d.lorebook ?? '',
            title: d.title ?? '',
            // 파일 목록을 못 받았으면 '사진 없음' 판정을 하지 않는다(거짓 양성 방지)
            hasImage: hasFileInfo ? files.has(avatarId) : true,
            tagIds: settings.personaTags[avatarId] ?? [],
            favorite: settings.favorites.includes(avatarId),
            recentIndex,
        };
    });
}

/**
 * 페르소나 전환 — ST 원래 함수 그대로.
 * @param {string} avatarId
 */
export async function switchPersona(avatarId) {
    if (!avatarId) return;
    await setUserAvatar(avatarId, { toastPersonaNameChange: true });
}

/**
 * ST가 등록해 둔 슬래시 커맨드의 콜백을 레지스트리에서 꺼내 그대로 부른다.
 *
 * 왜 문자열 명령이 아니라 콜백인가: 설명 본문에는 줄바꿈·따옴표·`|`·`{{매크로}}`가
 * 들어간다. 명령 문자열로 조립하면 파서가 그걸 먹어버린다. 콜백을 직접 부르면
 * 인자 객체가 그대로 전달돼 이스케이프 문제가 아예 없고, 실행되는 코드는
 * ST 본체의 updatePersonaCallback 그대로다(personas.js:2153).
 *
 * @param {object} args 이름있는 인자
 * @returns {Promise<string>} 갱신된 avatarId
 */
async function callPersonaUpdate(args) {
    const parser = ctx().SlashCommandParser;
    const cmd = parser?.commands?.['persona-update'];
    if (!cmd || typeof cmd.callback !== 'function') {
        throw new Error('ST의 /persona-update 명령을 찾지 못했어요. ST 버전을 확인해 주세요.');
    }
    return await cmd.callback(args, '');
}

/**
 * 이름 바꾸기 — 현재/비현재 페르소나 모두 ST의 updatePersonaCallback 경유.
 * 거기서 setUserName·PERSONA_RENAMED·목록 재렌더·저장까지 한 벌로 돈다.
 * @returns {Promise<boolean>}
 */
export async function renamePersonaSafe(avatarId, newName) {
    const trimmed = String(newName ?? '').trim();
    if (!trimmed || trimmed === getPersonaName(avatarId)) return false;
    await callPersonaUpdate({ persona: avatarId, name: trimmed });
    return true;
}

/**
 * 설명 바꾸기.
 *
 * - 현재 페르소나: ST 원래 입력칸 #persona_description 을 대리 조작한다.
 *   onPersonaDescriptionInput(personas.js:1206)이 그대로 돌아 토큰 카운트·목록 설명줄·
 *   PERSONA_UPDATED까지 따라온다. 토스트가 안 떠서 타이핑 중 조작에 알맞다.
 * - 그 외: updatePersonaCallback 경유(ST가 비현재 페르소나를 고치는 공식 경로).
 *
 * @returns {Promise<boolean>}
 */
export async function setDescriptionSafe(avatarId, text) {
    const value = String(text ?? '');
    if (value === (getDescriptor(avatarId).description ?? '')) return false;

    if (avatarId === getCurrentAvatarId()) {
        const el = document.querySelector('#persona_description');
        if (el) {
            // 원래 컨트롤을 사용자가 친 것과 같은 경로로 민다
            globalThis.jQuery(el).val(value).trigger('input');
            return true;
        }
        // 입력칸을 못 찾으면(테마·버전 차이) 공식 콜백으로 떨어진다
    }

    await callPersonaUpdate({ persona: avatarId, description: value });
    return true;
}

/**
 * ST 원래 페르소나 탭을 열고 해당 페르소나가 있는 페이지로 이동한다.
 * 서랍이 닫혀 있을 때만 누른다 — 열린 서랍을 또 누르면 닫힌다.
 * @param {string} avatarId
 */
export async function openOriginalTab(avatarId) {
    const drawer = document.querySelector('#PersonaManagement');
    if (drawer?.classList.contains('closedDrawer')) {
        globalThis.jQuery('#persona-management-button .drawer-toggle').trigger('click');
    }
    try {
        await getUserAvatars(true, avatarId);
    } catch (err) {
        console.error('[persona-manager] 원래 탭 이동 실패', err);
    }
}

/** ST 원래 페르소나 목록을 다시 그리게 한다. */
export async function rerenderOriginalList(openPageAt = '') {
    try {
        await getUserAvatars(true, openPageAt);
    } catch (err) {
        console.error('[persona-manager] 원래 목록 재렌더 실패', err);
    }
}

/**
 * 이미지 엘리먼트에 썸네일을 붙이고, 404면 ST 기본 얼굴로 떨어뜨린다.
 * @param {HTMLImageElement} img
 * @param {string} avatarId
 */
export function wireAvatarImage(img, avatarId) {
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
        if (img.dataset.pmFallback === '1') return;
        img.dataset.pmFallback = '1';
        img.src = DEFAULT_AVATAR_IMG;
    }, { once: true });
    img.src = thumbUrl(avatarId);
}
