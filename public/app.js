document.addEventListener('click', e => {
  const c = e.target.closest('[data-confirm]');
  if (c && !confirm(c.dataset.confirm)) { e.preventDefault(); return; }
  if (e.target.closest('[data-theme-toggle]')) {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch (_) {}
  }
  const b = e.target.closest('[data-back]');
  if (b) { history.length > 1 && document.referrer.startsWith(location.origin) ? history.back() : (location.href = b.dataset.back || '/'); }
  if (e.target.closest('[data-print]')) window.print();
});
document.addEventListener('click', e => {
  const t = e.target.closest('[data-check-all]'); if (!t) return;
  const boxes = [...t.closest('form').querySelectorAll('input[type=checkbox]')], all = boxes.every(b => b.checked);
  boxes.forEach(b => { b.checked = !all; });
});
