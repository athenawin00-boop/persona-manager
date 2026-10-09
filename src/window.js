/**
 * 떠 있는 창 뼈대 — 드래그·접기·닫기·z-index.
 *
 * 나중 확장들에서 공용화할 수 있게 ST 의존성 0으로 둔다(DOM API만 쓴다).
 *
 * 드래그 교훈(tts-remotcon 실측): pointerdown에서 즉시 setPointerCapture 하면
 * 이후 클릭이 핸들로 리타기팅돼 ✕·버튼이 먹통이 된다.
 * → 문턱(4px)을 넘은 뒤에만 캡처하고, 문턱을 넘었던 번의 클릭은 캡처 단계에서 한 번 삼킨다.
 */

const DRAG_THRESHOLD = 4;
const EDGE_MARGIN = 8;
const Z_BASE = 4000;

let zTop = Z_BASE;

/**
 * 창이 화면 밖으로 나가지 않게 가둔다.
 * @param {{x:number,y:number}} pos
 * @param {{w:number,h:number}} size
 * @param {{w:number,h:number}} viewport
 * @param {number} margin
 * @returns {{x:number,y:number}}
 */
export function clampPosition(pos, size, viewport, margin = EDGE_MARGIN) {
    const maxX = Math.max(margin, viewport.w - size.w - margin);
    const maxY = Math.max(margin, viewport.h - size.h - margin);
    return {
        x: Math.min(Math.max(pos.x, margin), maxX),
        y: Math.min(Math.max(pos.y, margin), maxY),
    };
}

function swallowClick(e) {
    e.stopPropagation();
    e.preventDefault();
}

/**
 * 핸들을 잡고 루트를 끄는 드래그를 건다.
 * @param {HTMLElement} root
 * @param {HTMLElement} handle
 */
function makeDraggable(root, handle) {
    let pending = false;
    let dragging = false;
    let startX = 0, startY = 0, baseX = 0, baseY = 0, pid = null;

    handle.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target instanceof Element && e.target.closest('input, select, textarea, button, .pm-nodrag')) return;
        const rect = root.getBoundingClientRect();
        pending = true;
        dragging = false;
        pid = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        baseX = rect.left;
        baseY = rect.top;
    });

    handle.addEventListener('pointermove', (e) => {
        if (!pending || e.pointerId !== pid) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            dragging = true;
            root.classList.add('pm-dragging');
            // 문턱을 넘은 뒤에만 캡처한다 — pointerdown 즉시 캡처하면 자식 버튼이 클릭을 못 받는다
            try { handle.setPointerCapture(pid); } catch { /* 무시 */ }
        }
        e.preventDefault();
        const rect = root.getBoundingClientRect();
        const pos = clampPosition(
            { x: baseX + dx, y: baseY + dy },
            { w: rect.width, h: rect.height },
            { w: window.innerWidth, h: window.innerHeight },
        );
        root.style.left = `${Math.round(pos.x)}px`;
        root.style.top = `${Math.round(pos.y)}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.transform = 'none';
    });

    const end = (e) => {
        if (!pending || (pid !== null && e.pointerId !== pid)) return;
        try { handle.releasePointerCapture(pid); } catch { /* 이미 해제됨 */ }
        pending = false;
        pid = null;
        if (!dragging) return;
        dragging = false;
        root.classList.remove('pm-dragging');
        root.addEventListener('click', swallowClick, { capture: true, once: true });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
}

/**
 * 떠 있는 창을 만든다. 만들기만 하고 열지는 않는다.
 *
 * @param {object} opts
 * @param {string} opts.id DOM id
 * @param {string} opts.title 제목줄 문구
 * @param {string} [opts.icon] Font Awesome 클래스(예: 'fa-solid fa-user')
 * @param {string} [opts.extraClass] 루트에 붙일 추가 클래스
 * @param {boolean} [opts.collapsible=true] 접기 버튼 표시
 * @param {function} [opts.onClose] 닫힐 때
 * @param {function} [opts.onOpen] 열릴 때
 * @returns {{root:HTMLElement, body:HTMLElement, header:HTMLElement, titleEl:HTMLElement,
 *            open:function, close:function, toggle:function, isOpen:function, front:function}}
 */
export function createFloatingWindow(opts) {
    const {
        id, title, icon = 'fa-solid fa-user', extraClass = '',
        collapsible = true, onClose = null, onOpen = null,
    } = opts;

    const existing = document.getElementById(id);
    if (existing) existing.remove();

    const root = document.createElement('div');
    root.id = id;
    root.className = `pm-window ${extraClass}`.trim();
    root.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'pm-window-header';

    const iconEl = document.createElement('i');
    iconEl.className = `${icon} pm-window-icon`;

    const titleEl = document.createElement('span');
    titleEl.className = 'pm-window-title';
    titleEl.textContent = title;

    const spacer = document.createElement('div');
    spacer.className = 'pm-window-spacer';

    const slot = document.createElement('div');
    slot.className = 'pm-window-headerslot pm-nodrag';

    header.append(iconEl, titleEl, spacer, slot);

    if (collapsible) {
        const collapseBtn = document.createElement('div');
        collapseBtn.className = 'pm-window-btn pm-nodrag pm-collapse';
        collapseBtn.title = '접기 / 펼치기';
        collapseBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const folded = root.classList.toggle('pm-collapsed');
            collapseBtn.querySelector('i').className = folded ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
        });
        header.append(collapseBtn);
    }

    const closeBtn = document.createElement('div');
    closeBtn.className = 'pm-window-btn pm-nodrag pm-close';
    closeBtn.title = '닫기';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    header.append(closeBtn);

    const body = document.createElement('div');
    body.className = 'pm-window-body';

    root.append(header, body);
    document.body.append(root);

    const api = {
        root, body, header, titleEl, headerSlot: slot,
        isOpen: () => root.style.display !== 'none',
        front() {
            zTop += 1;
            root.style.zIndex = String(zTop);
        },
        open() {
            root.style.display = '';
            api.front();
            onOpen?.();
        },
        close() {
            if (!api.isOpen()) return;
            root.style.display = 'none';
            onClose?.();
        },
        toggle() {
            api.isOpen() ? api.close() : api.open();
        },
    };

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        api.close();
    });

    // 클릭한 창이 위로
    root.addEventListener('pointerdown', () => api.front(), true);

    makeDraggable(root, header);

    return api;
}
