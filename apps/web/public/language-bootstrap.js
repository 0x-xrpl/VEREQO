(() => {
  const supported = value => value === 'en' || value === 'ja';
  const requested = new URLSearchParams(window.location.search).get('lang');
  let language = supported(requested) ? requested : null;
  if (!language) {
    try {
      const saved = window.localStorage.getItem('vereqo.language');
      if (supported(saved)) language = saved;
    } catch {
      // Storage may be unavailable; English remains the first-visit default.
    }
  }
  language ??= 'en';
  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;
})();
