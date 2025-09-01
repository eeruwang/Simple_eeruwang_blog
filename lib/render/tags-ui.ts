// src/lib/tags-ui.ts
/* ───────── 태그 레일 UI ───────── */
import { escapeHtml, escapeAttr } from "../util.js";

/** 필요한 env 키만 */
type EnvLike = { NOTES_TAGS?: string };

/* ───────── 환경변수 → 태그 목록 ───────── */
function parseList(str?: string): string[] {
  return String(str || "")
    .split(/[,\|]/g)
    .map((s: string) => s.trim())
    .filter((s: string) => Boolean(s));
}

export function getConfiguredTags(env?: EnvLike, fallback: string[] = []): string[] {
  const cfg: string[] = parseList(env?.NOTES_TAGS);
  const uniq = <T,>(arr: T[]): T[] => Array.from(new Set(arr));
  return cfg.length ? uniq(cfg) : uniq(fallback);
}

/* ───────── 태그바 HTML ───────── */
export function renderTagBar(activeTag: string = "all", tagList: string[] = []): string {
  const uniqList: string[] = Array.from(new Set(tagList));
  const list: string[] = ["all", ...uniqList];

  const link = (t: string): string => {
    const href: string = t === "all" ? "/" : `/tag/${encodeURIComponent(t)}`;
    const activeAttr: string = t === activeTag ? ' class="is-active"' : "";
    return `<a href="${href}" data-tag="${escapeAttr(t)}"${activeAttr}>${escapeHtml(t)}</a>`;
  };

  return `<nav class="tagrail" id="tagrail">${list.map(link).join("")}</nav>`;
}

/* ───────── 클라이언트 실행 스크립트 ─────────
   - 홈(/)에서는 목록을 부드럽게 필터
   - 태그 페이지(/tag/*)에서는 링크 내비게이션(서버 필터) 유지
*/
export const TAG_SCRIPT: string = `
(function () {
  const rail = document.getElementById('tagrail');
  if (!rail) return;

  // 홈에서는 클라필터, /tag/* 에서는 서버 내비게이션
  const CLIENT_FILTER = !location.pathname.startsWith('/tag/');

  const links = Array.from(rail.querySelectorAll('[data-tag]'));
  const listWrap = document.getElementById('post-list');

  // 초기 활성 태그 결정
  let initial = 'all';
  if (location.pathname.startsWith('/tag/')) {
    const seg = decodeURIComponent(location.pathname.split('/').pop() || '');
    if (seg) initial = seg;
  } else {
    const qs = new URLSearchParams(location.search);
    initial = qs.get('tag') || 'all';
  }
  if (!links.some(a => a.dataset.tag === initial)) initial = 'all';

  // 활성 표시 동기화(항상 실행)
  links.forEach(a => a.classList.toggle('is-active', a.dataset.tag === initial));

  // 태그 페이지에선 여기서 종료 → 링크로 서버 이동
  if (!CLIENT_FILTER) return;

  // ↓↓↓ 홈(/) 전용: DOM 목록을 부드럽게 필터
  const posts = Array.from(document.querySelectorAll('.post[data-tags]'));

  function listTransition(applyFn){
    if(!listWrap){ applyFn(); return; }
    listWrap.classList.remove('swap-in');
    listWrap.classList.add('swap-out');
    const onEnd = () => {
      listWrap.removeEventListener('animationend', onEnd);
      applyFn();
      requestAnimationFrame(()=>{
        listWrap.classList.remove('swap-out');
        listWrap.classList.add('swap-in');
      });
    };
    listWrap.addEventListener('animationend', onEnd, { once:true });
  }

  function ensureProgress(){
    let p = rail.querySelector('.progress');
    if (!p) {
      p = document.createElement('div');
      p.className = 'progress';
      p.setAttribute('role','status');
      p.setAttribute('aria-live','polite');
      p.innerHTML = '<span class="ind"></span>';
      rail.appendChild(p);
    }
    return p;
  }
  function showLoading(){ ensureProgress(); listWrap?.classList.add('is-loading'); }
  function hideLoading(){ rail.querySelector('.progress')?.remove(); listWrap?.classList.remove('is-loading'); }

  function apply(tag){
    links.forEach(a => a.classList.toggle('is-active', a.dataset.tag === tag));
    posts.forEach(p => {
      const tags = (p.dataset.tags || '').split(',').map(s=>s.trim()).filter(Boolean);
      p.classList.toggle('is-hidden', !(tag === 'all' || tags.includes(tag)));
    });
    const url = new URL(location.href);
    if (tag === 'all') url.searchParams.delete('tag');
    else url.searchParams.set('tag', tag);
    history.replaceState(null, '', url);
  }

  rail.addEventListener('click', (e)=>{
    const a = e.target.closest && e.target.closest('a[data-tag]');
    if(!a) return;
    // 홈에서만 가로채서 부드러운 필터 적용
    e.preventDefault();
    e.stopPropagation();
    showLoading();
    requestAnimationFrame(()=>{
      listTransition(()=> apply(a.dataset.tag));
      setTimeout(hideLoading, 260);
    });
  });

  // 홈 최초 진입 시 쿼리 적용
  apply(initial);
})();
`;
