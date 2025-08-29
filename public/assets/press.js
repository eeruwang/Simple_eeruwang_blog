// public/assets/press.js
/* Press interaction */
(function(){
  const SEL = 'a[href], button, [role="button"], .pressable';
  const add = el => el.classList.add('is-pressing');
  const rm  = el => el.classList.remove('is-pressing');
  document.addEventListener('pointerdown', (e)=>{ const t = e.target.closest && e.target.closest(SEL); if(!t) return; add(t); }, true);
  document.addEventListener('pointerup', ()=>{ document.querySelectorAll('.is-pressing').forEach(rm); }, true);
  document.addEventListener('pointercancel', ()=>{ document.querySelectorAll('.is-pressing').forEach(rm); }, true);
  document.addEventListener('pointerleave', (e)=>{ const t = e.target.closest && e.target.closest(SEL); if(t) rm(t); }, true);
  document.addEventListener('keydown', (e)=>{ if (e.key !== ' ' && e.key !== 'Enter') return; const t = document.activeElement; if (t && (t.matches && t.matches(SEL))) add(t); }, true);
  document.addEventListener('keyup', ()=>{ document.querySelectorAll('.is-pressing').forEach(rm); }, true);
})();