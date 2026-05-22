window.LSClip = {
  BASE_URL: '',
  init(opts) {
    if (opts && opts.BASE_URL) this.BASE_URL = opts.BASE_URL;
    this.restoreTheme();
  },
  restoreTheme() {
    const saved = localStorage.getItem('lsclip-theme');
    if (saved) {
      document.body.setAttribute('data-theme', saved);
      document.querySelectorAll('.theme-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.theme === saved);
      });
    }
  },
  setTheme(t) {
    document.body.setAttribute('data-theme', t);
    document.querySelectorAll('.theme-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === t);
    });
    localStorage.setItem('lsclip-theme', t);
  },
  toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    const container = document.getElementById('toasts');
    if (container) {
      container.appendChild(t);
      setTimeout(() => t.remove(), 3000);
    }
  },
  openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  },
  closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  },
  copyToClipboard(text) {
    if (navigator.clipboard) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); return Promise.resolve(true); }
    catch { return Promise.resolve(false); }
    finally { document.body.removeChild(ta); }
  },
  generateSlug() {
    const w = ['fox','pine','note','pad','drop','log','bits','flux','draft','snap','text','quick','byte','code','link','memo','data','sync','ark','hub','mind','node','vault','echo'];
    const s = w[Math.floor(Math.random()*w.length)] + '-' + w[Math.floor(Math.random()*w.length)] + '-' + (Math.floor(Math.random()*900)+100);
    return s;
  },
  async checkSlug(slug) {
    try {
      const r = await fetch('/api/check/' + encodeURIComponent(slug));
      return await r.json();
    } catch { return { available: false }; }
  },
  selectPill(groupId, el) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
  },
  togglePasswordFields() {
    const group = document.getElementById('accessModePills');
    if (!group) return;
    const active = group.querySelector('.pill.active');
    const mode = active ? active.dataset.mode : 'full_public';
    const pwFields = document.getElementById('passwordFields');
    if (!pwFields) return;
    if (mode === 'full_public') {
      pwFields.classList.add('hidden');
    } else {
      pwFields.classList.remove('hidden');
    }
  },
  updateCharCount() {
    const counter = document.getElementById('charWordCount');
    if (!counter) return;
    const tip = window.tiptapEditor;
    if (tip && tip.getText) {
      const text = tip.getText() || '';
      const chars = text.length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      counter.textContent = chars + ' chars \u00b7 ' + words + ' words';
    } else {
      const el = document.getElementById('editorContent');
      if (!el) return;
      const text = el.innerText || '';
      const chars = text.length;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      counter.textContent = chars + ' chars \u00b7 ' + words + ' words';
    }
  }
};

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
});