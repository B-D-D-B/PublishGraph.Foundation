(() => {
  document.documentElement.classList.add('js');
  const summary = document.querySelector('[data-error-summary]');
  if (summary) {
    summary.focus();
    summary.addEventListener('click', event => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const field = document.getElementById(link.getAttribute('href').slice(1));
      if (field) { event.preventDefault(); field.focus(); }
    });
  }
  const button = document.querySelector('.nav-toggle');
  const navigation = document.querySelector('#site-nav');
  if (!button || !navigation) return;
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    navigation.dataset.open = String(open);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || button.getAttribute('aria-expanded') !== 'true') return;
    button.setAttribute('aria-expanded', 'false');
    navigation.dataset.open = 'false';
    button.focus();
  });
  window.matchMedia('(min-width: 48rem)').addEventListener('change', event => {
    if (!event.matches) return;
    button.setAttribute('aria-expanded', 'false');
    navigation.dataset.open = 'false';
  });
})();
