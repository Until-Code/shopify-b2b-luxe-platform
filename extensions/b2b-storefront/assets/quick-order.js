/**
 * <b2b-quick-order> — bulk ordering by SKU for B2B buyers.
 *
 * 1. Lines are typed or pasted from a spreadsheet ("SKU, qty" / "SKU<TAB>qty").
 * 2. SKUs are resolved to variant ids via the app proxy (signed by Shopify).
 * 3. Items are added in one call to the Ajax Cart API; Shopify enforces the
 *    buyer's quantity rules and applies contextual B2B prices.
 */
class B2bQuickOrder extends HTMLElement {
  connectedCallback() {
    this.i18n = JSON.parse(this.dataset.i18n || '{}');
    this.tbody = this.querySelector('[data-rows]');
    this.status = this.querySelector('[data-status]');

    const rows = Number(this.dataset.rows) || 5;
    for (let i = 0; i < rows; i++) this.addRow();

    this.querySelector('[data-add-row]').addEventListener('click', () => this.addRow().focus());
    this.querySelector('[data-submit]').addEventListener('click', () => this.submit());
    this.querySelector('[data-paste-apply]').addEventListener('click', () => this.importPaste());
    this.tbody.addEventListener('change', (event) => {
      if (event.target.matches('[name="sku"]')) this.resolve([event.target.closest('tr')]);
    });
    this.tbody.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove]');
      if (button) button.closest('tr').remove();
    });
  }

  addRow(sku = '', quantity = '') {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input name="sku" autocomplete="off" spellcheck="false" aria-label="${this.t('sku')}"></td>
      <td data-product class="b2b__muted"></td>
      <td class="b2b__num"><input name="quantity" type="number" min="0" inputmode="numeric" aria-label="${this.t('quantity')}"></td>
      <td><button type="button" class="b2b__icon-button" data-remove aria-label="${this.t('remove')}">×</button></td>`;
    row.querySelector('[name="sku"]').value = sku;
    row.querySelector('[name="quantity"]').value = quantity;
    this.tbody.append(row);
    return row.querySelector('[name="sku"]');
  }

  /** Parses spreadsheet lines: "SKU, 12", "SKU;12" or "SKU<TAB>12". */
  static parseLines(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sku, quantity] = line.split(/[\t,;]+/).map((part) => part.trim());
        return { sku: sku.toUpperCase(), quantity: Number.parseInt(quantity, 10) || 1 };
      });
  }

  async importPaste() {
    const textarea = this.querySelector('[data-paste]');
    const lines = B2bQuickOrder.parseLines(textarea.value);
    if (!lines.length) return;

    // Reuse empty rows first.
    [...this.tbody.rows].forEach((row) => {
      if (!row.querySelector('[name="sku"]').value) row.remove();
    });
    lines.forEach(({ sku, quantity }) => this.addRow(sku, quantity));
    textarea.value = '';
    this.querySelector('details').open = false;
    await this.resolve([...this.tbody.rows]);
  }

  rowsWithSku(rows = [...this.tbody.rows]) {
    return rows.filter((row) => row.querySelector('[name="sku"]').value.trim());
  }

  async resolve(rows) {
    rows = this.rowsWithSku(rows);
    if (!rows.length) return;
    const skus = rows.map((row) => row.querySelector('[name="sku"]').value.trim().toUpperCase());

    const url = new URL(this.dataset.proxyUrl, location.origin);
    url.searchParams.set('skus', skus.join(','));
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(String(response.status));
      const { variants } = await response.json();
      const bySku = new Map(variants.map((v) => [v.sku, v]));

      rows.forEach((row, index) => {
        const result = bySku.get(skus[index]);
        const cell = row.querySelector('[data-product]');
        row.dataset.variantId = result?.found && result.available ? result.variantId : '';
        row.classList.toggle('b2b__row--invalid', !row.dataset.variantId);
        cell.textContent = !result?.found
          ? this.t('not_found')
          : result.available
            ? result.title
            : `${result.title} — ${this.t('unavailable')}`;
      });
    } catch {
      this.setStatus(this.t('error'), true);
    }
  }

  async submit() {
    const rows = this.rowsWithSku();
    if (rows.some((row) => row.dataset.variantId === undefined)) await this.resolve(rows);

    const items = rows
      .filter((row) => row.dataset.variantId)
      .map((row) => ({
        id: Number(row.dataset.variantId),
        quantity: Number.parseInt(row.querySelector('[name="quantity"]').value, 10) || 0,
      }))
      .filter((item) => item.quantity > 0);
    if (!items.length) return;

    this.setBusy(true);
    try {
      const response = await fetch(this.dataset.cartAddUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items }),
      });
      const body = await response.json();
      if (!response.ok) {
        // e.g. 422 "You can only add multiples of 6 of this item"
        this.setStatus(body.description || body.message || this.t('error'), true);
        return;
      }
      this.setStatus(`${this.t('added')} `, false, { href: this.dataset.cartUrl, label: this.t('view_cart') });
      document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
    } catch {
      this.setStatus(this.t('error'), true);
    } finally {
      this.setBusy(false);
    }
  }

  setBusy(busy) {
    const button = this.querySelector('[data-submit]');
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  }

  setStatus(message, isError = false, link) {
    this.status.textContent = message;
    this.status.classList.toggle('b2b__status--error', isError);
    if (link) {
      const a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.label;
      this.status.append(a);
    }
  }

  t(key) {
    return this.i18n[key] || key;
  }
}

if (!customElements.get('b2b-quick-order')) customElements.define('b2b-quick-order', B2bQuickOrder);
