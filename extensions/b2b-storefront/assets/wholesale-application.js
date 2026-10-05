/** Progressive enhancement of the wholesale application form (works without JS too). */
document.querySelectorAll('form[data-b2b-application]').forEach((form) => {
  const status = form.querySelector('[data-status]');
  const success = form.querySelector('[data-success]');
  const button = form.querySelector('[type="submit"]');

  const clearErrors = () => {
    form.querySelectorAll('[data-error-for]').forEach((el) => (el.textContent = ''));
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    status.textContent = '';
    button.disabled = true;

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      });
      const body = await response.json().catch(() => ({}));

      if (response.ok && body.ok) {
        form.querySelectorAll('.b2b__grid, [type="submit"]').forEach((el) => (el.hidden = true));
        success.hidden = false;
        success.focus?.();
        return;
      }

      Object.entries(body.errors || {}).forEach(([field, messages]) => {
        const target = form.querySelector(`[data-error-for="${field}"]`);
        const input = form.querySelector(`[name="${field}"]`);
        if (target) target.textContent = messages.join(' ');
        input?.setAttribute('aria-invalid', 'true');
      });
      status.textContent = form.dataset.errorMessage;
      form.querySelector('[aria-invalid="true"]')?.focus();
    } catch {
      status.textContent = form.dataset.errorMessage;
    } finally {
      button.disabled = false;
    }
  });
});
