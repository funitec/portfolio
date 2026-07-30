/* =========================================================================
   Shared UI behaviour: nav, scroll reveal, works filter, video facades,
   image galleries. Used by the top page and every work detail page.
   ========================================================================= */
(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---- reading progress + nav background ---- */
  const nav = $('.nav');
  const bar = $('.progress');
  if (nav || bar) {
    const onScroll = () => {
      if (nav) nav.classList.toggle('stuck', window.scrollY > 10);
      if (bar) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---- mobile nav ---- */
  const toggle = $('.nav-toggle');
  const links  = $('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    $$('a', links).forEach(a => a.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }

  /* ---- scroll reveal ---- */
  const targets = $$('.rv');
  if (targets.length) {
    if (!('IntersectionObserver' in window)) {
      targets.forEach(el => el.classList.add('in'));
    } else {
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
      targets.forEach(el => io.observe(el));
    }
  }

  /* ---- works category filter ---- */
  const tabs = $$('.tab');
  if (tabs.length) {
    const cards = $$('.wcard');
    tabs.forEach(tab => tab.addEventListener('click', () => {
      tabs.forEach(t => { t.classList.remove('on'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('on');
      tab.setAttribute('aria-selected', 'true');
      const f = tab.dataset.filter;
      cards.forEach(c => {
        const show = f === 'all' || c.dataset.cat === f;
        c.classList.toggle('gone', !show);
        if (show) {
          c.classList.remove('in');
          requestAnimationFrame(() => c.classList.add('in'));
        }
      });
    }));
  }

  /* ---- click-to-load video embeds (keeps the page light) ---- */
  $$('.vfacade').forEach(f => {
    const load = () => {
      if (f.querySelector('iframe') || !f.dataset.embed) return;
      const ifr = document.createElement('iframe');
      ifr.src = f.dataset.embed;
      ifr.allow = 'autoplay; encrypted-media; picture-in-picture';
      ifr.allowFullscreen = true;
      ifr.title = f.getAttribute('aria-label') || '動画';
      f.replaceChildren(ifr);
      f.style.cursor = 'default';
    };
    f.addEventListener('click', load);
    f.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); load(); }
    });
  });

  /* ---- image gallery (thumbnails swap the main shot) ---- */
  $$('.gal').forEach(gal => {
    const main = $('.gal-main img', gal);
    const btns = $$('.gal-thumbs button', gal);
    if (!main || !btns.length) return;
    btns.forEach(btn => btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      main.style.opacity = '0';
      const swap = () => { main.src = btn.dataset.src; main.style.opacity = '1'; };
      setTimeout(swap, 140);
    }));
  });
})();
