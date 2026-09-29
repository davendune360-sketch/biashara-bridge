// ============================================================
// Storage helpers
// ============================================================
const get = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
};
const setLS = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const storagePrefix = (email) => email ? `biasharaBridge::${email}::` : 'biasharaBridge::local::';

// Live state
let orders = [], products = [], customers = [], hiddenCustomerKeys = [], collapsedProducts = [];
let profile = { businessName:'', ownerName:'', businessPhone:'', photo:'' };
let activeFilter = 'all', searchTerm = '', inventorySearchTerm = '', customerSearchTerm = '';
let editingCustomerName = null, editingProductName = null, restockingProductName = null, editingOrderId = null;
let lowStockLimit = 3;

// Cloud state
let cloudSession = null, cloudBusinessId = null, cloudSyncBusy = false;
let currentEmail = '';
let autoSyncTimeout = null;

// UI flags
const FLAG_WELCOME_SHOWN = 'biasharaBridge::flags::welcomeShown';
const FLAG_TOUR_DONE     = 'biasharaBridge::flags::tourDone';
const FLAG_REMINDER_SESSION = 'biasharaBridge::flags::reminderShownThisSession';
const FLAG_IS_DEMO       = 'biasharaBridge::flags::isDemo';

// ---------- Save & load ----------
function currentPrefix(){ return storagePrefix(currentEmail); }

function save(){
  const p = currentPrefix();
  setLS(p + 'orders', orders);
  setLS(p + 'products', products);
  setLS(p + 'customers', customers);
  setLS(p + 'hidden', hiddenCustomerKeys);
  setLS(p + 'collapsed', collapsedProducts);
  setLS(p + 'profile', profile);
  setLS(p + 'lowStockLimit', lowStockLimit);
}

function loadFromStorage(email){
  const p = storagePrefix(email);
  orders = get(p + 'orders', []);
  products = get(p + 'products', []);
  customers = get(p + 'customers', []);
  hiddenCustomerKeys = get(p + 'hidden', []);
  collapsedProducts = get(p + 'collapsed', []);
  profile = get(p + 'profile', { businessName:'', ownerName:'', businessPhone:'', photo:'' });
  lowStockLimit = Number(get(p + 'lowStockLimit', 3)) || 3;
}

function clearLiveState(){
  orders = []; products = []; customers = []; hiddenCustomerKeys = []; collapsedProducts = [];
  profile = { businessName:'', ownerName:'', businessPhone:'', photo:'' };
  lowStockLimit = 3;
}

const isDemoMode = () => localStorage.getItem(FLAG_IS_DEMO) === '1';
const setDemoFlag = (v) => v ? localStorage.setItem(FLAG_IS_DEMO, '1') : localStorage.removeItem(FLAG_IS_DEMO);

// ---------- Utility ----------
const money = v => `KSh ${Number(v || 0).toLocaleString('en-KE')}`;
const displayDate = date => date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-KE',{day:'numeric',month:'short',year:'numeric'}) : 'Date not recorded';
const escapeHtml = text => { const el = document.createElement('div'); el.textContent = text || ''; return el.innerHTML; };
const statusLabel = { pending:'Pending', paid:'Paid', preparing:'Preparing', delivered:'Delivered' };
const skuSuffix = name => String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
const productTotalStock = p => Array.isArray(p.variantDetails) && p.variantDetails.length
  ? p.variantDetails.reduce((s, v) => s + (Number(v.stock) || 0), 0)
  : (Number(p.stock) || 0);

const hasRealData = () => products.length > 0 || orders.length > 0 || customers.length > 0;

// ---------- Payment helpers ----------
const PAYMENT_REFERENCE_METHODS = new Set(['M-Pesa','Bank transfer','Card','Airtel Money','Other']);
const paymentNeedsReference = (m) => m !== 'Cash';

function describePayment(o) {
  // o.paymentMethod, o.paymentOther, o.mpesa (reference)
  const method = o.paymentMethod || (o.mpesa ? 'M-Pesa' : '');
  if (!method) return '';
  if (method === 'Other' && o.paymentOther) {
    return o.mpesa ? `${o.paymentOther} · ${o.mpesa}` : o.paymentOther;
  }
  if (method === 'Cash') return 'Cash';
  return o.mpesa ? `${method} · ${o.mpesa}` : method;
}

// ============================================================
// Smart capitalisation
// ============================================================
const PROTECTED_WORDS = [
  // Brands / tech
  'iPhone','iPad','iPod','MacBook','iMac','WiFi','Bluetooth','USB','LED','HDMI','TV','AC','DC',
  // Kenyan businesses / banks
  'M-Pesa','Airtel','Safaricom','Telkom','KCB','Equity','NCBA','DTB','Absa','StanChart','Stanbic','Co-op','Cooperative','KRA','NHIF','SHA','NSSF',
  // Places
  'Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Thika','Malindi','Kitale','Nyeri','Meru','CBD','Kenya'
];

function isProtected(word) {
  const norm = word.replace(/[^\p{L}\p{N}-]/gu,'');
  return PROTECTED_WORDS.some(p => p.toLowerCase() === norm.toLowerCase());
}

function preserveProtected(word) {
  const norm = word.replace(/[^\p{L}\p{N}-]/gu,'');
  const match = PROTECTED_WORDS.find(p => p.toLowerCase() === norm.toLowerCase());
  return match || null;
}

function isAllLower(s) { return s === s.toLowerCase(); }
function isAllUpper(s) { return s === s.toUpperCase(); }
function hasMixedCase(s) { return !isAllLower(s) && !isAllUpper(s); }

function smartTitleCase(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return trimmed;
  // If user typed mixed case deliberately, trust them
  if (hasMixedCase(trimmed)) return trimmed;
  // Otherwise rebuild
  return trimmed.split(/\s+/).map(word => {
    const protectedForm = preserveProtected(word);
    if (protectedForm) return protectedForm;
    if (word.length === 0) return word;
    // Handle hyphenated pieces: e.g. "led-bulb" -> "Led-Bulb"
    return word.split('-').map(part => {
      if (!part) return part;
      const pp = preserveProtected(part);
      if (pp) return pp;
      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join('-');
  }).join(' ');
}

function smartSentenceCase(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return trimmed;
  if (hasMixedCase(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  // Capitalise first letter and after . ! ?
  return lower.replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, m => m.toUpperCase());
}

function smartSkuCase(input) {
  return String(input || '').toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
}

function applyCase(inputEl) {
  const mode = inputEl.dataset.case;
  if (!mode) return;
  const original = inputEl.value;
  if (!original) return;
  let next = original;
  if (mode === 'title') next = smartTitleCase(original);
  else if (mode === 'sentence') next = smartSentenceCase(original);
  else if (mode === 'sku') next = smartSkuCase(original);
  if (next !== original) inputEl.value = next;
}

// Wire all elements with data-case on blur, and also handle dynamically-added fields
document.addEventListener('blur', (e) => {
  if (e.target && e.target.matches && e.target.matches('[data-case]')) applyCase(e.target);
}, true);

// ============================================================
// Auto-close three-dot menus
// ============================================================
document.addEventListener('click', e => {
 
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('details.action-menu[open], details.order-action-menu[open], details.topbar-menu[open], details.orders-menu[open]').forEach(d => d.removeAttribute('open'));
  }
});

// ============================================================
// Rendering
// ============================================================
function render() {
  const visible = (activeFilter === 'all' ? orders : orders.filter(o => o.status === activeFilter)).filter(o => `${o.customer} ${o.item} ${o.channel}`.toLowerCase().includes(searchTerm));
  document.querySelector('#ordersBody').innerHTML = visible.map(o => {
    let linesHtml = '';
    if (Array.isArray(o.lines) && o.lines.length) {
      linesHtml = o.lines.map(l =>
        `<span class="order-line"><b>${escapeHtml(l.name)}${l.specs ? ` - ${escapeHtml(l.specs)}` : ''}</b> × ${l.quantity} = ${money(l.quantity * l.unitPrice)}</span>`
      ).join('');
    } else {
      linesHtml = `<span class="order-line"><b>${escapeHtml(o.item)}${o.specs ? ` - ${escapeHtml(o.specs)}` : ''}</b> × ${o.quantity || 1} = ${money(o.amount)}</span>`;
    }
    const paymentLine = describePayment(o);
    return `<tr>
      <td class="customer-cell"><b>${escapeHtml(o.customer)}</b><small>${escapeHtml(o.phone || 'Customer')}</small></td>
      <td>
        <div class="order-lines">${linesHtml}</div>
        <small class="sold-date">Sold: ${displayDate(o.saleDate)}</small>
        ${paymentLine ? `<small class="mpesa">${escapeHtml(paymentLine)}</small>` : ''}
      </td>
      <td><span class="channel"><i class="dot"></i>${escapeHtml(o.channel)}</span></td>
      <td><b>${money(o.amount)}</b></td>
      <td><select class="status-select ${o.status}" data-status="${o.id}">${Object.entries(statusLabel).map(([key,label]) => `<option value="${key}" ${o.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
      <td class="row-actions">
        <details class="order-action-menu">
          <summary aria-label="Order actions">⋮</summary>
          <div>
            ${o.status === 'pending' ? `<button class="mark-paid" data-paid="${o.id}">Mark paid</button>` : ''}
            <button class="edit-order" data-edit-order="${o.id}">Edit order</button>
            <button class="receipt-button" data-receipt="${o.id}">Receipt</button>
            <button class="delete" data-delete="${o.id}">Delete</button>
          </div>
        </details>
      </td>
    </tr>`;
  }).join('');
  document.querySelector('#emptyState').hidden = orders.length > 0;
  document.querySelector('table').hidden = orders.length === 0;
  const total = orders.reduce((sum,o) => sum + Number(o.amount),0);
  const pending = orders.filter(o => o.status === 'pending').length;
  const custCount = new Set(orders.map(o => o.customer.trim().toLowerCase())).size;
  document.querySelector('#salesStat').textContent = money(total);
  document.querySelector('#openStat').textContent = pending;
  document.querySelector('#customerStat').textContent = custCount;
  document.querySelector('#salesNote').textContent = orders.length ? `${orders.length} order${orders.length === 1 ? '' : 's'} recorded` : 'Add your first order';
  document.querySelector('#openNote').textContent = pending ? 'Need your follow-up' : 'You are all caught up';
  document.querySelector('#customerNote').textContent = custCount ? 'People who have bought from you' : 'Start building your list';
  document.querySelector('#orderBadge').textContent = orders.length;

  renderInventory(); renderCustomers(); renderReports(); renderCustomerDatalist(); renderProductCombo();
  updateGreeting(); updateNudgeBanner();
}

function renderInventory() {
  const visibleProducts = products.filter(p => `${p.name} ${p.category||''} ${p.sku||''} ${p.variants||''} ${(p.variantDetails||[]).map(v=>v.name).join(' ')}`.toLowerCase().includes(inventorySearchTerm));
  if (!visibleProducts.length) {
    document.querySelector('#inventoryGrid').innerHTML = `<div class="inventory-empty">${products.length ? 'No products match that search.' : 'No stock added yet. Add your products to start tracking stock.'}</div>`;
    return;
  }
  const rows = visibleProducts.map(p => {
    const variants = Array.isArray(p.variantDetails) ? p.variantDetails : [];
    const hasVariants = variants.length > 0;
    const totalStock = productTotalStock(p);
    const isCollapsed = collapsedProducts.includes(p.name);
    const parentPriceCell = hasVariants ? '<span class="muted-dash">—</span>' : `<b>${money(p.price)}</b><small>per ${escapeHtml(p.unit || 'piece')}</small>`;
    const parentStockCell = hasVariants
      ? `<strong class="${totalStock <= lowStockLimit ? 'low-stock' : ''}">${totalStock} ${escapeHtml(p.unit || 'units')}<small>across ${variants.length} specs</small></strong>`
      : `<strong class="${Number(p.stock) <= lowStockLimit ? 'low-stock' : ''}">${p.category === 'Services' ? 'Standard' : `${p.stock} ${escapeHtml(p.unit || 'units')}`}</strong>`;

    const toggle = hasVariants
      ? `<button type="button" class="variant-toggle${isCollapsed ? ' collapsed' : ''}" data-toggle-variants="${encodeURIComponent(p.name)}" aria-label="Toggle specs">▾</button>`
      : '';
    const variantLabel = hasVariants ? `<span class="variant-count">${variants.length} spec${variants.length===1?'':'s'}</span>` : '';

    const parentRow = `<tr class="parent-row">
      <td data-label="Product">${toggle}<b>${escapeHtml(p.name)}</b>${variantLabel}<small>${escapeHtml(p.sku || 'No code')}</small></td>
      <td data-label="Category">${escapeHtml(p.category || 'General')}</td>
      <td data-label="Price">${parentPriceCell}</td>
      <td data-label="Stock">${parentStockCell}</td>
      <td class="row-actions">
        <details class="action-menu">
          <summary aria-label="More product actions">⋮</summary>
          <div>
            <button class="restock-button" data-restock-product="${encodeURIComponent(p.name)}">Restock</button>
            <button class="edit-product" data-edit-product="${encodeURIComponent(p.name)}">Edit</button>
            <button class="remove-product" data-remove-product="${encodeURIComponent(p.name)}">Remove</button>
          </div>
        </details>
      </td>
    </tr>`;

    const variantRows = hasVariants ? variants.map(v => {
      const code = p.sku ? `${p.sku}-${skuSuffix(v.name)}` : '';
      const vStock = Number(v.stock) || 0;
      return `<tr class="variant-row${isCollapsed ? ' hidden-row' : ''}" data-parent="${escapeHtml(p.name)}">
        <td data-label="Spec"><span class="variant-branch">↳</span> <b>${escapeHtml(v.name)}</b><small>${escapeHtml(code || 'No code')}</small></td>
        <td data-label="Category"></td>
        <td data-label="Price"><b>${money(v.price)}</b><small>per ${escapeHtml(p.unit || 'piece')}</small></td>
        <td data-label="Stock"><strong class="${vStock <= lowStockLimit ? 'low-stock' : ''}">${vStock} ${escapeHtml(p.unit || 'units')}</strong></td>
        <td class="row-actions">
          <details class="action-menu">
            <summary aria-label="Variant actions">⋮</summary>
            <div>
              <button class="restock-button" data-restock-product="${encodeURIComponent(p.name)}" data-restock-variant="${encodeURIComponent(v.name)}">Restock</button>
            </div>
          </details>
        </td>
      </tr>`;
    }).join('') : '';

    return parentRow + variantRows;
  }).join('');
  document.querySelector('#inventoryGrid').innerHTML = `<div class="table-wrap"><table class="inventory-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderCustomerDatalist() {
  // No longer needed — the customer autocomplete is now a custom dropdown.
  // Kept as a no-op so the render() call doesn't crash.
  const el = document.querySelector('#customerOptions');
  if (!el) return;
  const names = customers.map(c => c.name).filter(Boolean);
  el.innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

function renderProductCombo() {
  const groups = [];
  products.forEach(p => {
    const variants = Array.isArray(p.variantDetails) ? p.variantDetails : [];
    if (variants.length) {
      groups.push(`<optgroup label="${escapeHtml(p.name)}">`);
      variants.forEach(v => {
        groups.push(`<option value="${escapeHtml(p.name)}|||${escapeHtml(v.name)}" data-product="${escapeHtml(p.name)}" data-spec="${escapeHtml(v.name)}" data-price="${Number(v.price)||0}" data-stock="${Number(v.stock)||0}">${escapeHtml(p.name)} — ${escapeHtml(v.name)} (${money(v.price)})</option>`);
      });
      groups.push(`</optgroup>`);
    } else {
      groups.push(`<option value="${escapeHtml(p.name)}|||" data-product="${escapeHtml(p.name)}" data-spec="" data-price="${Number(p.price)||0}" data-stock="${Number(p.stock)||0}">${escapeHtml(p.name)} (${money(p.price)})</option>`);
    }
  });
  document.querySelectorAll('.order-combo-select').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = `<option value="">— Choose a product —</option>` + groups.join('');
    if (current) sel.value = current;
  });
}

function renderCustomers() {
  const people = customers.map(c => ({...c, count:0, spend:0}));
  orders.forEach(o => {
    const key = o.customer.trim().toLowerCase();
    let c = people.find(x => x.name.trim().toLowerCase() === key);
    if (!c) { c = { name:o.customer, phone:o.phone, email:'', area:'', notes:'', count:0, spend:0 }; people.push(c); }
    c.count++; c.spend += Number(o.amount);
    if (!c.phone && o.phone) c.phone = o.phone;
  });
  const visiblePeople = people.filter(c => !hiddenCustomerKeys.includes(c.name.trim().toLowerCase())).filter(c => `${c.name} ${c.phone||''} ${c.email||''} ${c.area||''}`.toLowerCase().includes(customerSearchTerm));
  document.querySelector('#customerList').innerHTML = visiblePeople.length ? `<div class="table-wrap"><table class="customer-table"><thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Total spent</th><th></th></tr></thead><tbody>${visiblePeople.map(c => `<tr><td data-label="Customer"><b>${escapeHtml(c.name)}</b>${c.area ? `<small>${escapeHtml(c.area)}</small>` : ''}</td><td data-label="Contact">${escapeHtml(c.phone || c.email || 'No contact saved')}<small>${c.notes ? escapeHtml(c.notes) : ''}</small></td><td data-label="Orders">${c.count}</td><td data-label="Total spent"><b>${money(c.spend)}</b></td><td class="row-actions"><button class="edit-customer" data-edit-customer="${encodeURIComponent(c.name)}">Edit</button><button class="remove-customer" data-remove-customer="${encodeURIComponent(c.name)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted-copy">Add a customer here, or create an order and they will appear automatically.</p>';
}

function upsertCustomer(name, phone) {
  const key = name.trim().toLowerCase();
  hiddenCustomerKeys = hiddenCustomerKeys.filter(k => k !== key);
  const existing = customers.find(c => c.name.trim().toLowerCase() === key);
  if (existing) { if (!existing.phone && phone) existing.phone = phone; }
  else customers.push({ name, phone: phone||'', email:'', area:'', notes:'' });
}

function renderReports() {
  const paid = orders.filter(o => ['paid','preparing','delivered'].includes(o.status));
  const pending = orders.filter(o => o.status === 'pending');
  const channels = {}; paid.forEach(o => channels[o.channel] = (channels[o.channel] || 0) + Number(o.amount));
  const best = Object.entries(channels).sort((a,b) => b[1]-a[1])[0];
  document.querySelector('#bestChannel').textContent = best ? best[0] : '—';
  document.querySelector('#paidSales').textContent = money(paid.reduce((s,o) => s + Number(o.amount),0));
  document.querySelector('#outstanding').textContent = money(pending.reduce((s,o) => s + Number(o.amount),0));
}

function updateGreeting() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour<12 ? 'Good morning' : hour<17 ? 'Good afternoon' : 'Good evening';
  const eyebrow = document.querySelector('#topbarDate');
  if (eyebrow) eyebrow.textContent = now.toLocaleDateString('en-KE',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();
  const el = document.querySelector('#topbarGreeting');
  if (!el) return;
  const name = (profile.ownerName || '').trim().split(' ')[0];
  if (!name) { el.innerHTML = greeting; return; }
  if (currentEmail) { el.innerHTML = `${greeting}, ${escapeHtml(name)} <span>👋</span>`; }
  else { el.innerHTML = `${greeting}, ${escapeHtml(name)}`; }
}

function renderProfile() {
  const initials = (profile.ownerName || '').split(' ').map(n=>n[0]).filter(Boolean).join('').slice(0,2).toUpperCase() || '·';
  document.querySelector('#profileInitials').textContent = initials;
  document.querySelector('#avatarFallback').textContent = initials;
  document.querySelector('#profileImage').hidden = !profile.photo;
  document.querySelector('#profilePreview').hidden = !profile.photo;
  if (profile.photo) { document.querySelector('#profileImage').src = profile.photo; document.querySelector('#profilePreview').src = profile.photo; }
  updateGreeting();
}

// ============================================================
// Info + confirm dialogs
// ============================================================
const infoDialog = document.querySelector('#infoDialog');
function showInfo({ title='Done', message='', icon='✓' } = {}) {
  document.querySelector('#infoIcon').textContent = icon;
  document.querySelector('#infoTitle').textContent = title;
  document.querySelector('#infoMessage').textContent = message;
  infoDialog.showModal();
}
document.querySelector('#infoOk').addEventListener('click', () => infoDialog.close());

const confirmDialog = document.querySelector('#confirmDialog');
function askConfirm({title='Are you sure?', message='', confirmLabel='Yes, continue'} = {}) {
  return new Promise(resolve => {
    document.querySelector('#confirmTitle').textContent = title;
    document.querySelector('#confirmMessage').textContent = message;
    document.querySelector('#confirmProceed').textContent = confirmLabel;
    const proceedBtn = document.querySelector('#confirmProceed'), cancelBtn = document.querySelector('#confirmCancel');
    function cleanup(result) {
      proceedBtn.removeEventListener('click', onProceed);
      cancelBtn.removeEventListener('click', onCancel);
      confirmDialog.removeEventListener('cancel', onCancel);
      confirmDialog.close();
      resolve(result);
    }
    function onProceed(){ cleanup(true); }
    function onCancel(){ cleanup(false); }
    proceedBtn.addEventListener('click', onProceed);
    cancelBtn.addEventListener('click', onCancel);
    confirmDialog.addEventListener('cancel', onCancel);
    confirmDialog.showModal();
  });
}

// ============================================================
// Nudge banner
// ============================================================
function updateNudgeBanner() {
  const banner = document.querySelector('#cloudNudgeBanner');
  if (!banner) return;
  const dismissed = sessionStorage.getItem('biasharaBridge::flags::nudgeDismissedThisSession') === '1';
  const show = hasRealData() && !currentEmail && !dismissed;
  banner.hidden = !show;
}
document.querySelector('#nudgeDismiss').addEventListener('click', () => {
  sessionStorage.setItem('biasharaBridge::flags::nudgeDismissedThisSession','1');
  updateNudgeBanner();
});
document.querySelector('#nudgeSignIn').addEventListener('click', () => {
  showCloudStep('login');
  cloudDialog.showModal();
});

// ============================================================
// Cloud / multi-account
// ============================================================
const orderDialog = document.querySelector('#orderDialog'), profileDialog = document.querySelector('#profileDialog'), productDialog = document.querySelector('#productDialog'), customerDialog = document.querySelector('#customerDialog'), restockDialog = document.querySelector('#restockDialog'), receiptDialog = document.querySelector('#receiptDialog');
const cloudDialog = document.querySelector('#cloudDialog'), settingsDialog = document.querySelector('#settingsDialog'), welcomeDialog = document.querySelector('#welcomeDialog'), tourDialog = document.querySelector('#tourDialog'), signInReminderDialog = document.querySelector('#signInReminderDialog');
const cloudConfig = window.BIASHARA_SUPABASE || {};
const cloudReady = Boolean(cloudConfig.url && cloudConfig.anonKey && window.supabase?.createClient);
const cloudClient = cloudReady ? window.supabase.createClient(cloudConfig.url, cloudConfig.anonKey) : null;

function updateCloudStateUI(session) {
  const button = document.querySelector('#cloudButton');
  const status = document.querySelector('#cloudStatus');
  const settingsStatus = document.querySelector('#settingsCloudStatus');
  const signOutBtn = document.querySelector('#settingsSignOut');
  const signInBtn = document.querySelector('#settingsSignIn');
  button.textContent = session ? 'Cloud connected' : 'Cloud sync';
  if (session) {
    status.textContent = `Signed in as ${session.user.email}. Cloud sync is ready.`;
    settingsStatus.textContent = `Connected as ${session.user.email}`;
    signOutBtn.hidden = false; signInBtn.hidden = true;
  } else {
    status.textContent = `Your current data is saved only in this browser. Sign in to sync across devices — or just close this window to keep using the app locally.`;
    settingsStatus.textContent = `You're not signed in. Sign in to back up your data to the cloud and sync across devices.`;
    signOutBtn.hidden = true; signInBtn.hidden = false;
  }
  document.querySelector('#cloudEmail').hidden = Boolean(session);
  document.querySelector('#cloudPassword').hidden = Boolean(session);
  document.querySelector('#cloudSignIn').hidden = Boolean(session);
  document.querySelector('#cloudSignUp').hidden = Boolean(session);
  document.querySelector('.forgot-password-row').hidden = Boolean(session);
  document.querySelector('.cloud-dismiss-row').hidden = Boolean(session);
}

function showCloudAlert(message, title='ERROR') {
  const box = document.querySelector('#cloudAlert');
  box.hidden = false;
  box.querySelector('b').textContent = title;
  document.querySelector('#cloudAlertMessage').textContent = message;
}
function hideCloudAlert(){ document.querySelector('#cloudAlert').hidden = true; }
function showCloudStep(step) {
  document.querySelector('#loginStep').hidden = step !== 'login';
  document.querySelector('#requestCodeStep').hidden = step !== 'request';
  document.querySelector('#verifyCodeStep').hidden = step !== 'verify';
  hideCloudAlert();
  document.querySelector('#cloudDialogTitle').textContent = step === 'login' ? 'Sign in to sync' : step === 'request' ? 'Reset your password' : 'Enter your code';
}

async function ensureCloudBusiness(session) {
  const existing = await cloudClient.from('businesses').select('id').eq('owner_id', session.user.id).limit(1);
  if (existing.error) throw existing.error;
  if (existing.data?.length) return existing.data[0].id;
  const created = await cloudClient.from('businesses').insert({
    owner_id: session.user.id,
    name: profile.businessName || 'My business',
    owner_name: profile.ownerName || '',
    phone: profile.businessPhone || ''
  }).select('id').single();
  if (created.error) throw created.error;
  return created.data.id;
}

async function cloudBusinessIsEmpty() {
  if (!cloudBusinessId) return true;
  const [p, c, o] = await Promise.all([
    cloudClient.from('products').select('id', { count: 'exact', head: true }).eq('business_id', cloudBusinessId),
    cloudClient.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', cloudBusinessId),
    cloudClient.from('orders').select('id', { count: 'exact', head: true }).eq('business_id', cloudBusinessId)
  ]);
  return (!p.count && !c.count && !o.count);
}

async function pushProductsToCloud() {
  if (!cloudClient || !cloudSession) return;
  cloudSyncBusy = true;
  try {
    cloudBusinessId = cloudBusinessId || await ensureCloudBusiness(cloudSession);
    const removed = await cloudClient.from('products').delete().eq('business_id', cloudBusinessId);
    if (removed.error) throw removed.error;
    if (products.length) {
      const rows = products.map(p => ({
        business_id: cloudBusinessId, name: p.name, category: p.category || 'Other',
        sku: p.sku || '', unit: p.unit || 'piece', variants: p.variants || '',
        price: Number(p.price) || 0, stock: Number(p.stock) || 0
      }));
      const inserted = await cloudClient.from('products').insert(rows).select('id,name,category,sku,unit,variants,price,stock');
      if (inserted.error) throw inserted.error;
      const detailsByName = {}; products.forEach(p => detailsByName[p.name] = p.variantDetails || []);
      products = inserted.data.map(row => ({ ...row, variantDetails: detailsByName[row.name] || [] }));
      save();
    }
  } catch (err) { console.error('pushProductsToCloud failed', err); }
  finally { cloudSyncBusy = false; }
}

async function pushCustomersToCloud() {
  if (!cloudClient || !cloudSession) return;
  cloudBusinessId = cloudBusinessId || await ensureCloudBusiness(cloudSession);
  const removed = await cloudClient.from('customers').delete().eq('business_id', cloudBusinessId);
  if (removed.error) throw removed.error;
  if (customers.length) {
    const rows = customers.map(c => ({ business_id: cloudBusinessId, name: c.name, phone: c.phone||'', email: c.email||'', area: c.area||'', notes: c.notes||'' }));
    const inserted = await cloudClient.from('customers').insert(rows);
    if (inserted.error) throw inserted.error;
  }
}

async function pushOrdersToCloud() {
  if (!cloudClient || !cloudSession) return;
  cloudBusinessId = cloudBusinessId || await ensureCloudBusiness(cloudSession);
  const removed = await cloudClient.from('orders').delete().eq('business_id', cloudBusinessId);
  if (removed.error) throw removed.error;
  if (orders.length) {
    const custRows = await cloudClient.from('customers').select('id,name').eq('business_id', cloudBusinessId);
    if (custRows.error) throw custRows.error;
    const rows = orders.map(o => {
      const c = custRows.data.find(cc => cc.name.trim().toLowerCase() === (o.customer||'').trim().toLowerCase());
      const paymentMethod = o.paymentMethod || (o.mpesa ? 'M-Pesa' : '');
      const paymentOther = o.paymentOther || '';
      const combinedMpesa = [paymentMethod, paymentOther].filter(Boolean).join('|');
      return {
        business_id: cloudBusinessId, customer_id: c?.id || null,
        customer_name: o.customer, phone: o.phone||'', item: o.item,
        quantity: Number(o.quantity)||1, unit_price: Number(o.unitPrice||o.amount)||0,
        amount: Number(o.amount)||0, specs: o.specs||'', notes: o.notes||'',
        channel: o.channel||'WhatsApp', sale_date: o.saleDate,
        status: o.status||'pending',
        mpesa: o.mpesa || ''
      };
    });
    const inserted = await cloudClient.from('orders').insert(rows);
    if (inserted.error) throw inserted.error;
  }
}

async function syncAllCloudData() {
  if (!cloudClient || !cloudSession || cloudSyncBusy) return;
  cloudSyncBusy = true;
  try {
    cloudBusinessId = cloudBusinessId || await ensureCloudBusiness(cloudSession);
    const pr = await cloudClient.from('products').select('id,name,category,sku,unit,variants,price,stock').eq('business_id', cloudBusinessId);
    if (pr.error) throw pr.error;
    if (pr.data.length) { products = pr.data; } else if (products.length) { await pushProductsToCloud(); }

    const cu = await cloudClient.from('customers').select('name,phone,email,area,notes').eq('business_id', cloudBusinessId);
    if (cu.error) throw cu.error;
    if (cu.data.length) { customers = cu.data; } else if (customers.length) { await pushCustomersToCloud(); }

    const od = await cloudClient.from('orders').select('customer_name,phone,item,quantity,unit_price,amount,specs,notes,channel,sale_date,status,mpesa,created_at').eq('business_id', cloudBusinessId).order('created_at', { ascending: false });
    if (od.error) throw od.error;
    if (od.data.length) {
      orders = od.data.map(o => ({ customer:o.customer_name, phone:o.phone, item:o.item, quantity:o.quantity, unitPrice:o.unit_price, amount:o.amount, specs:o.specs, notes:o.notes, channel:o.channel, saleDate:o.sale_date, status:o.status, mpesa:o.mpesa, id:Date.parse(o.created_at)||Date.now() }));
    } else if (orders.length) { await pushOrdersToCloud(); }

    const bi = await cloudClient.from('businesses').select('name,owner_name,phone,photo_url').eq('id', cloudBusinessId).single();
    if (!bi.error && bi.data) {
      profile = { ...profile, businessName: bi.data.name || profile.businessName, ownerName: bi.data.owner_name || profile.ownerName, businessPhone: bi.data.phone || '', photo: bi.data.photo_url || profile.photo };
    }
    save();
    render(); renderProfile();
  } catch (err) { console.error('syncAllCloudData failed', err); }
  finally { cloudSyncBusy = false; }
}

async function pushProfileToCloud() {
  if (!cloudClient || !cloudSession || !cloudBusinessId) return;
  await cloudClient.from('businesses').update({
    name: profile.businessName, owner_name: profile.ownerName,
    phone: profile.businessPhone||'', photo_url: profile.photo||''
  }).eq('id', cloudBusinessId);
}

function syncAfterLocalChange(syncFunction) {
  save(); render();
  if (cloudSession && !cloudSyncBusy) {
    if (autoSyncTimeout) clearTimeout(autoSyncTimeout);
    autoSyncTimeout = setTimeout(async () => {
      cloudSyncBusy = true;
      try {
        cloudBusinessId = cloudBusinessId || await ensureCloudBusiness(cloudSession);
        await syncFunction();
      } catch (err) { console.error('auto-sync failed', err); }
      finally { cloudSyncBusy = false; }
    }, 400);
  } else if (!cloudSession) {
    updateNudgeBanner();
  }
}

async function handleCloudSession(session) {
  cloudSession = session;
  cloudBusinessId = null;

  if (session) {
    const email = session.user.email;
    if (currentEmail !== email) {
      // Save off any local scratch data before switching namespaces
      const localHadDemo = isDemoMode() && (products.length || customers.length || orders.length);

      clearLiveState();
      currentEmail = email;
      loadFromStorage(email);

      // Check the cloud business — is it brand new?
      try {
        cloudBusinessId = await ensureCloudBusiness(session);
        const empty = await cloudBusinessIsEmpty();

        if (empty) {
          // Brand new cloud account
          if (localHadDemo) {
            // Demo data was showing — start clean
            orders = []; products = []; customers = [];
            hiddenCustomerKeys = []; collapsedProducts = [];
            setDemoFlag(false);
            save();
          } else {
            // Real local data — push it up so the user keeps their work
            // (products/customers/orders already loaded from the local namespace via loadFromStorage above)
            if (products.length || customers.length || orders.length) {
              await pushProductsToCloud();
              await pushCustomersToCloud();
              await pushOrdersToCloud();
            }
          }
        }
      } catch (err) { console.error('first-signin handling failed', err); }
    }

    updateCloudStateUI(session);
    await syncAllCloudData();
    showInfo({ title:'Signed in', message:`You're signed in as ${email}. Your data will now sync to the cloud.`, icon:'✓' });
  } else {
    clearLiveState();
    currentEmail = '';
    loadFromStorage('');
    updateCloudStateUI(null);
    render(); renderProfile();
    maybeShowWelcome();
  }
}

document.querySelector('#cloudButton').addEventListener('click', async () => {
  if (cloudClient) {
    const { data } = await cloudClient.auth.getSession();
    await handleCloudSession(data.session);
  }
  showCloudStep('login');
  cloudDialog.showModal();
});
document.querySelector('.close-cloud').addEventListener('click', () => { cloudDialog.close(); showCloudStep('login'); });
document.querySelector('#dismissCloud').addEventListener('click', () => { cloudDialog.close(); showCloudStep('login'); });

document.querySelector('#cloudForm').addEventListener('submit', async e => {
  e.preventDefault();
  const onLogin = !document.querySelector('#loginStep').hidden;
  const onRequest = !document.querySelector('#requestCodeStep').hidden;
  if (!onLogin) { (onRequest ? document.querySelector('#sendResetCode') : document.querySelector('#confirmResetPassword')).click(); return; }
  hideCloudAlert();
  if (!cloudClient) { updateCloudStateUI(null); return; }
  const { error } = await cloudClient.auth.signInWithPassword({
    email: document.querySelector('#cloudEmail').value,
    password: document.querySelector('#cloudPassword').value
  });
  if (error) showCloudAlert('Invalid email or password. Please try again.');
  else cloudDialog.close();
});

document.querySelector('#cloudSignUp').addEventListener('click', async () => {
  hideCloudAlert();
  if (!cloudClient) { updateCloudStateUI(null); return; }
  const { error } = await cloudClient.auth.signUp({
    email: document.querySelector('#cloudEmail').value,
    password: document.querySelector('#cloudPassword').value
  });
  if (error) showCloudAlert(error.message);
  else {
    cloudDialog.close();
    showInfo({ title:'Account created', message:'Check your email to confirm your address, then sign in to start syncing.', icon:'✓' });
  }
});

document.querySelector('#forgotPasswordLink').addEventListener('click', () => {
  hideCloudAlert();
  document.querySelector('#resetEmail').value = document.querySelector('#cloudEmail').value || '';
  showCloudStep('request');
});
document.querySelector('#backToLoginFromRequest').addEventListener('click', () => showCloudStep('login'));
document.querySelector('#backToLoginFromVerify').addEventListener('click', () => showCloudStep('login'));

document.querySelector('#sendResetCode').addEventListener('click', async () => {
  hideCloudAlert();
  if (!cloudClient) { showCloudAlert('Cloud sync is not set up yet.'); return; }
  const email = document.querySelector('#resetEmail').value.trim();
  if (!email) { showCloudAlert('Enter your registered email first.'); return; }
  const btn = document.querySelector('#sendResetCode');
  btn.disabled = true;
  const { error } = await cloudClient.auth.resetPasswordForEmail(email);
  btn.disabled = false;
  if (error) { showCloudAlert(error.message); return; }
  document.querySelector('#resetEmailDisplay').textContent = email;
  showCloudStep('verify');
});

document.querySelector('#confirmResetPassword').addEventListener('click', async () => {
  hideCloudAlert();
  if (!cloudClient) return;
  const email = document.querySelector('#resetEmail').value.trim();
  const code = document.querySelector('#resetCode').value.trim();
  const np = document.querySelector('#resetNewPassword').value;
  const cp = document.querySelector('#resetConfirmPassword').value;
  if (!code) { showCloudAlert('Enter the code sent to your email.'); return; }
  if (np.length < 6) { showCloudAlert('Password must be at least 6 characters.'); return; }
  if (np !== cp) { showCloudAlert('Passwords do not match.'); return; }
  const btn = document.querySelector('#confirmResetPassword');
  btn.disabled = true;
  const verify = await cloudClient.auth.verifyOtp({ email, token: code, type: 'recovery' });
  if (verify.error) { btn.disabled = false; showCloudAlert('That code is invalid or has expired.'); return; }
  const update = await cloudClient.auth.updateUser({ password: np });
  btn.disabled = false;
  if (update.error) { showCloudAlert(update.error.message); return; }
  cloudDialog.close();
  showInfo({ title:'Password reset', message:'You are now signed in.', icon:'✓' });
});

document.querySelector('#settingsSignOut').addEventListener('click', async () => {
  if (cloudClient) await cloudClient.auth.signOut();
  await handleCloudSession(null);
});
document.querySelector('#settingsSignIn').addEventListener('click', () => {
  settingsDialog.close();
  showCloudStep('login');
  cloudDialog.showModal();
});

// Cloud auth listener
if (cloudClient) {
  cloudClient.auth.getSession().then(({ data }) => {
    if (data.session) {
      currentEmail = data.session.user.email;
      loadFromStorage(currentEmail);
      handleCloudSession(data.session);
    } else {
      currentEmail = '';
      loadFromStorage('');
      updateCloudStateUI(null);
      render(); renderProfile();
      maybeShowWelcome();
    }
  });
  cloudClient.auth.onAuthStateChange((_event, session) => {
    const newEmail = session?.user?.email || '';
    if (newEmail !== currentEmail) handleCloudSession(session);
  });
} else {
  currentEmail = '';
  loadFromStorage('');
  updateCloudStateUI(null);
  render(); renderProfile();
  maybeShowWelcome();
}

// ============================================================
// Welcome + tour
// ============================================================
const TOUR_STEPS = [
  { title: 'Inventory', body: 'Add your products and stock here. Products can have multiple specs (sizes, colours, wattage...), each with its own price and stock.' },
  { title: 'Orders', body: 'Record every sale here. Pick the product and its spec, set the quantity, and Biashara Bridge calculates the total for you.' },
  { title: 'Customers', body: 'Your community. Search, edit, or remove customers. Past orders stay even if you remove someone from the directory.' },
  { title: 'Cloud sync', body: 'Optional. Sign in to back up your data and sync across devices. You can keep using the app without ever signing in.' }
];
let tourIndex = 0;

function openTour() { tourIndex = 0; showTourStep(); tourDialog.showModal(); }
function showTourStep() {
  const step = TOUR_STEPS[tourIndex];
  document.querySelector('#tourStepLabel').textContent = `STEP ${tourIndex + 1} OF ${TOUR_STEPS.length}`;
  document.querySelector('#tourTitle').textContent = step.title;
  document.querySelector('#tourBody').textContent = step.body;
  document.querySelector('#tourNext').textContent = tourIndex === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';
}
document.querySelector('#tourNext').addEventListener('click', () => {
  if (tourIndex < TOUR_STEPS.length - 1) { tourIndex++; showTourStep(); }
  else { localStorage.setItem(FLAG_TOUR_DONE, '1'); tourDialog.close(); }
});
document.querySelector('#tourSkip').addEventListener('click', () => {
  localStorage.setItem(FLAG_TOUR_DONE, '1');
  tourDialog.close();
});
document.querySelector('#tourButton').addEventListener('click', openTour);

function maybeShowWelcome() {
  const shown = localStorage.getItem(FLAG_WELCOME_SHOWN) === '1';
  const tourDone = localStorage.getItem(FLAG_TOUR_DONE) === '1';
  if (shown || tourDone) return;
  if (hasRealData()) return;
  if (currentEmail) return;
  welcomeDialog.showModal();
}
document.querySelector('#welcomeTour').addEventListener('click', () => {
  localStorage.setItem(FLAG_WELCOME_SHOWN, '1');
  welcomeDialog.close();
  openTour();
});
document.querySelector('#welcomeSkip').addEventListener('click', () => {
  localStorage.setItem(FLAG_WELCOME_SHOWN, '1');
  welcomeDialog.close();
});

// ============================================================
// Sign-in reminder on visit
// ============================================================
function maybeShowSignInReminder() {
  if (currentEmail) return;
  if (!hasRealData()) return;
  if (sessionStorage.getItem(FLAG_REMINDER_SESSION) === '1') return;
  sessionStorage.setItem(FLAG_REMINDER_SESSION, '1');
  signInReminderDialog.showModal();
}
document.querySelector('#reminderSignIn').addEventListener('click', () => {
  signInReminderDialog.close();
  showCloudStep('login');
  cloudDialog.showModal();
});
document.querySelector('#reminderLater').addEventListener('click', () => signInReminderDialog.close());

// ============================================================
// beforeunload warning
// ============================================================
window.addEventListener('beforeunload', (e) => {
  if (!hasRealData()) return;
  if (currentEmail) return;
  e.preventDefault();
  e.returnValue = '';
  return '';
});

// ============================================================
// Settings dialog
// ============================================================
(function wireSettings(){
  const settingsBtn = document.querySelector('#settingsButton');
  const settingsDialogEl = document.querySelector('#settingsDialog');
  const closeBtn = document.querySelector('.close-settings');
  if (!settingsBtn || !settingsDialogEl) return;
  const freshBtn = settingsBtn.cloneNode(true);
  settingsBtn.parentNode.replaceChild(freshBtn, settingsBtn);
  freshBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('details.topbar-menu[open]').forEach(d => d.removeAttribute('open'));
    if (typeof updateCloudStateUI === 'function') updateCloudStateUI(cloudSession);
    settingsDialogEl.showModal();
  });
  if (closeBtn) {
    const freshClose = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(freshClose, closeBtn);
    freshClose.addEventListener('click', () => settingsDialogEl.close());
  }
})();

// ============================================================
// Reset business data
// ============================================================
async function resetBusinessData(){
  const ok = await askConfirm({
    title: 'Start afresh?',
    message: cloudSession
      ? 'This will permanently delete every customer, product, and order for this business from this browser and the cloud. Your account, profile, and appearance settings will stay.'
      : 'This will permanently delete every customer, product, and order saved on this device. Your profile and appearance settings will stay.',
    confirmLabel: 'Yes, reset data'
  });
  if (!ok) return;
  const btn = document.querySelector('#resetBusinessData');
  btn.disabled = true;
  document.querySelector('#settingsCloudStatus').textContent = cloudSession ? 'Resetting cloud data…' : 'Resetting local data…';
  try {
    if (cloudClient && cloudSession) {
      cloudBusinessId = cloudBusinessId || await ensureCloudBusiness(cloudSession);
      for (const table of ['orders','customers','products']) {
        const result = await cloudClient.from(table).delete().eq('business_id', cloudBusinessId);
        if (result.error) throw result.error;
      }
    }
    orders = []; products = []; customers = []; hiddenCustomerKeys = []; collapsedProducts = []; lowStockLimit = 3;
    setDemoFlag(false);
    save();
    document.querySelector('#lowStockLimit').value = lowStockLimit;
    render();
    settingsDialog.close();
    showInfo({ title:'Data reset', message: cloudSession ? 'Your business data has been cleared from this browser and the cloud.' : 'Your local data has been cleared from this browser.', icon:'✓' });
  } catch (err) {
    console.error('Reset failed', err);
    document.querySelector('#settingsCloudStatus').textContent = 'Reset error';
    showInfo({ title:'Reset failed', message:'The reset could not be completed. Please check your connection and try again.', icon:'⚠' });
  } finally {
    btn.disabled = false;
  }
}
(function wireReset(){
  const resetBtn = document.querySelector('#resetBusinessData');
  if (!resetBtn) return;
  const fresh = resetBtn.cloneNode(true);
  resetBtn.parentNode.replaceChild(fresh, resetBtn);
  fresh.addEventListener('click', resetBusinessData);
})();

// ============================================================
// DEMO DATA — TechPoint Electronics
// ============================================================
document.querySelector('#demoBtn').addEventListener('click', () => {
  if (hasRealData()) {
    alert('Demo data can only be loaded when the app is empty.');
    return;
  }

  products = [
    { name:'LED Bulb', category:'Electronics & accessories', sku:'LED-B', unit:'piece',
      variants:'9W warm, 9W daylight, 12W warm, 12W daylight, 18W daylight',
      variantDetails:[
        { name:'9W warm',       price:250, stock:12 },
        { name:'9W daylight',   price:260, stock:8  },
        { name:'12W warm',      price:300, stock:6  },
        { name:'12W daylight',  price:320, stock:5  },
        { name:'18W daylight',  price:450, stock:3  }
      ],
      price:250, stock:34 },

    { name:'Extension Cable', category:'Electronics & accessories', sku:'EXT-C', unit:'piece',
      variants:'3m white, 3m black, 5m white, 5m black, 9m black',
      variantDetails:[
        { name:'3m white', price:400, stock:10 },
        { name:'3m black', price:400, stock:8  },
        { name:'5m white', price:600, stock:6  },
        { name:'5m black', price:600, stock:6  },
        { name:'9m black', price:850, stock:4  }
      ],
      price:600, stock:34 },

    { name:'Phone Charger', category:'Electronics & accessories', sku:'CHRG', unit:'piece',
      variants:'Type-C 18W, Type-C 25W, Micro USB 12W, iPhone Lightning 20W',
      variantDetails:[
        { name:'Type-C 18W',            price:550, stock:10 },
        { name:'Type-C 25W',            price:700, stock:6  },
        { name:'Micro USB 12W',         price:400, stock:8  },
        { name:'iPhone Lightning 20W',  price:800, stock:4  }
      ],
      price:500, stock:28 },

    { name:'Electrical Installation', category:'Services', sku:'ELEC-INS', unit:'service',
      variants:'Single room, Full house, Commercial space',
      variantDetails:[
        { name:'Single room',       price:1500,  stock:0 },
        { name:'Full house',        price:5500,  stock:0 },
        { name:'Commercial space',  price:12000, stock:0 }
      ],
      price:1500, stock:0 },

    { name:'Wall Socket', category:'Electronics & accessories', sku:'SOCK', unit:'piece',
      variants:'13A single, 13A double, USB + 13A double',
      variantDetails:[
        { name:'13A single',        price:250, stock:15 },
        { name:'13A double',        price:450, stock:10 },
        { name:'USB + 13A double',  price:750, stock:5  }
      ],
      price:250, stock:30 }
  ];

  customers = [
    { name:'Wanjiku Njoroge', phone:'0712 345 678', email:'', area:'Kileleshwa', notes:'Prefers WhatsApp, pays via M-Pesa' },
    { name:'Brian Otieno',    phone:'0705 802 111', email:'', area:'Westlands',  notes:'Orders in bulk for Airbnb units' },
    { name:'Mama Akinyi',     phone:'0722 000 000', email:'', area:'Kibera',     notes:'Walk-in, cash only' },
    { name:'Sarah Kimani',    phone:'0733 456 789', email:'', area:'Kilimani',   notes:'Interior designer — bulk lights' },
    { name:'David Mwangi',    phone:'0711 222 333', email:'', area:'Industrial Area', notes:'Electrical contractor — recurring' },
    { name:'Faith Wambui',    phone:'0745 987 654', email:'', area:'Karen',     notes:'Hotel manager, seasonal orders' }
  ];

  const daysAgo = n => new Date(Date.now() - n*86400000).toISOString().slice(0,10);

  orders = [
    {
      id: Date.now() - 6000,
      customer:'David Mwangi', phone:'0711 222 333', channel:'WhatsApp',
      saleDate: daysAgo(5), status:'delivered',
      paymentMethod:'M-Pesa', mpesa:'QJK8N3P4R',
      notes:'Invoiced for tax purposes',
      lines:[
        { name:'Electrical Installation', specs:'Full house',    quantity:1,  unitPrice:5500 },
        { name:'Extension Cable',         specs:'9m black',      quantity:4,  unitPrice:850  },
        { name:'LED Bulb',                specs:'18W daylight',  quantity:10, unitPrice:450  }
      ],
      item:'Electrical Installation (1), Extension Cable (4), LED Bulb (10)',
      quantity:15, unitPrice:893.33, amount:13400,
      specs:'Full house; 9m black; 18W daylight'
    },
    {
      id: Date.now() - 5000,
      customer:'Brian Otieno', phone:'0705 802 111', channel:'Instagram',
      saleDate: daysAgo(3), status:'preparing',
      paymentMethod:'Bank transfer', mpesa:'KCB-9921',
      notes:'Deliver to Westlands, Airbnb property #2',
      lines:[
        { name:'LED Bulb',      specs:'12W daylight', quantity:10, unitPrice:320 },
        { name:'Wall Socket',   specs:'13A double',   quantity:5,  unitPrice:450 },
        { name:'Phone Charger', specs:'Type-C 25W',   quantity:3,  unitPrice:700 }
      ],
      item:'LED Bulb (10), Wall Socket (5), Phone Charger (3)',
      quantity:18, unitPrice:419.44, amount:7550,
      specs:'12W daylight; 13A double; Type-C 25W'
    },
    {
      id: Date.now() - 4000,
      customer:'Faith Wambui', phone:'0745 987 654', channel:'Facebook',
      saleDate: daysAgo(2), status:'paid',
      paymentMethod:'Card', mpesa:'AUTH-88210',
      notes:'Installation scheduled for next Monday',
      lines:[
        { name:'Electrical Installation', specs:'Commercial space', quantity:1,  unitPrice:12000 },
        { name:'LED Bulb',                specs:'12W warm',         quantity:30, unitPrice:300   }
      ],
      item:'Electrical Installation (1), LED Bulb (30)',
      quantity:31, unitPrice:677.42, amount:21000,
      specs:'Commercial space; 12W warm'
    },
    {
      id: Date.now() - 3000,
      customer:'Sarah Kimani', phone:'0733 456 789', channel:'Referral',
      saleDate: daysAgo(1), status:'pending',
      paymentMethod:'Bank transfer', mpesa:'',
      notes:'Awaiting bank transfer — do not deliver until cleared',
      lines:[
        { name:'LED Bulb',    specs:'12W warm',         quantity:20, unitPrice:300 },
        { name:'Wall Socket', specs:'USB + 13A double', quantity:8,  unitPrice:750 }
      ],
      item:'LED Bulb (20), Wall Socket (8)',
      quantity:28, unitPrice:428.57, amount:12000,
      specs:'12W warm; USB + 13A double'
    },
    {
      id: Date.now() - 2000,
      customer:'Wanjiku Njoroge', phone:'0712 345 678', channel:'WhatsApp',
      saleDate: daysAgo(0), status:'paid',
      paymentMethod:'M-Pesa', mpesa:'QGT4K9L2M',
      notes:'Deliver to Kileleshwa on Saturday',
      lines:[
        { name:'LED Bulb',        specs:'9W warm',   quantity:4, unitPrice:250 },
        { name:'Extension Cable', specs:'3m white',  quantity:1, unitPrice:400 }
      ],
      item:'LED Bulb (4), Extension Cable (1)',
      quantity:5, unitPrice:280, amount:1400,
      specs:'9W warm; 3m white'
    },
    {
      id: Date.now() - 1000,
      customer:'Mama Akinyi', phone:'0722 000 000', channel:'Walk-in',
      saleDate: daysAgo(0), status:'paid',
      paymentMethod:'Cash', mpesa:'',
      notes:'',
      lines:[
        { name:'LED Bulb',        specs:'9W daylight', quantity:6, unitPrice:260 },
        { name:'Extension Cable', specs:'5m black',    quantity:1, unitPrice:600 }
      ],
      item:'LED Bulb (6), Extension Cable (1)',
      quantity:7, unitPrice:308.57, amount:2160,
      specs:'9W daylight; 5m black'
    }
  ];

  save(); render();
  setDemoFlag(true);
  showInfo({
    title: 'Example data loaded',
    message: 'This is TechPoint Electronics — a sample shop. Explore Orders, Inventory, and Customers to see how everything connects. When you are ready, sign in with Cloud sync to keep your own data.',
    icon: '✦'
  });
});

// ============================================================
// Clear all buttons
// ============================================================
document.querySelector('#clearOrdersButton').addEventListener('click', async () => {
  if (!orders.length) { alert('There are no orders to clear.'); return; }
  const ok = await askConfirm({ title:'Clear all orders?', message:`This will permanently delete all ${orders.length} order${orders.length===1?'':'s'}. Products and customers will stay.`, confirmLabel:'Yes, clear orders' });
  if (!ok) return;
  orders = []; setDemoFlag(false); syncAfterLocalChange(() => pushOrdersToCloud());
});
document.querySelector('#clearInventoryButton').addEventListener('click', async () => {
  if (!products.length) { alert('There is no stock to clear.'); return; }
  const ok = await askConfirm({ title:'Clear all stock?', message:`This will permanently remove all ${products.length} product${products.length===1?'':'s'}. Orders and customers will stay.`, confirmLabel:'Yes, clear stock' });
  if (!ok) return;
  products = []; setDemoFlag(false); save(); render();
  if (cloudSession) pushProductsToCloud();
});
document.querySelector('#clearCustomersButton').addEventListener('click', async () => {
  if (!customers.length) { alert('There are no customers to clear.'); return; }
  const ok = await askConfirm({ title:'Clear all customers?', message:`This will permanently remove all ${customers.length} customer${customers.length===1?'':'s'}. Orders will stay in your records.`, confirmLabel:'Yes, clear customers' });
  if (!ok) return;
  customers = []; hiddenCustomerKeys = []; setDemoFlag(false); save(); render();
  if (cloudSession) pushCustomersToCloud();
});

// ============================================================
// Order form
// ============================================================
document.querySelectorAll('.add-order').forEach(b => b.addEventListener('click', () => {
  editingOrderId = null;
  document.querySelector('#orderDialogTitle').textContent = 'Add an order';
  document.querySelector('#orderForm').reset();
  resetOrderItems();
  document.querySelector('#saleDate').value = new Date().toISOString().slice(0,10);
  renderProductCombo();
  onPaymentMethodChange();
  orderDialog.showModal();
}));
document.querySelector('.close').addEventListener('click', () => orderDialog.close());

function orderRows() { return [...document.querySelectorAll('.order-item-row')]; }
function calculateOrderTotal() {
  const total = orderRows().reduce((sum,row) => sum + (Number(row.querySelector('.order-quantity').value)||0) * (Number(row.querySelector('.order-unit-price').value)||0), 0);
  document.querySelector('#orderAmount').value = total || '';
}
function makeOrderItemRow() {
  const row = document.createElement('div');
  row.className = 'order-item-row';
  row.innerHTML = `
    <select class="order-combo-select" required aria-label="Choose product and spec">
      <option value="">— Choose a product —</option>
    </select>
    <input class="order-quantity" name="quantity" type="number" min="1" value="1" required aria-label="Quantity" />
    <input class="order-unit-price" name="unitPrice" type="number" min="1" required placeholder="Unit price" aria-label="Unit price" />
    <button class="remove-order-item" type="button" aria-label="Remove item">×</button>`;
  return row;
}
function resetOrderItems() {
  const container = document.querySelector('#orderItems');
  container.innerHTML = '';
  container.appendChild(makeOrderItemRow());
  renderProductCombo();
}
document.querySelector('#orderItems').addEventListener('input', e => {
  if (e.target.matches('.order-quantity,.order-unit-price')) calculateOrderTotal();
});
document.querySelector('#orderItems').addEventListener('change', e => {
  if (e.target.matches('.order-combo-select')) {
    const opt = e.target.selectedOptions[0];
    const row = e.target.closest('.order-item-row');
    const priceInput = row.querySelector('.order-unit-price');
    if (opt && opt.dataset.price !== undefined && opt.value) priceInput.value = Number(opt.dataset.price) || 0;
    else priceInput.value = '';
    calculateOrderTotal();
  }
});
document.querySelector('#orderItems').addEventListener('click', e => {
  if (e.target.matches('.remove-order-item') && orderRows().length > 1) {
    e.target.closest('.order-item-row').remove();
    calculateOrderTotal();
  }
});
document.querySelector('#addOrderItem').addEventListener('click', () => {
  const row = makeOrderItemRow();
  document.querySelector('#orderItems').append(row);
  renderProductCombo();
  row.querySelector('.order-combo-select').focus();
});

// ---- Payment method toggles ----
const paymentMethodSelect = document.querySelector('#paymentMethodSelect');
const paymentReferenceLabel = document.querySelector('#paymentReferenceLabel');
const paymentReferenceInput = document.querySelector('#paymentReferenceInput');
const paymentOtherLabel = document.querySelector('#paymentOtherLabel');

function onPaymentMethodChange() {
  const val = paymentMethodSelect.value;
  // Other free-text
  paymentOtherLabel.hidden = (val !== '__other__');
  // Reference — hide for Cash, show for everything else
  const needsRef = val !== 'Cash';
  paymentReferenceLabel.hidden = !needsRef;
  // Adjust reference placeholder per method
  if (needsRef) {
    const map = {
      'M-Pesa': 'e.g. QHJ7K2L9M',
      'Bank transfer': 'e.g. KCB-9921',
      'Card': 'e.g. AUTH-88210',
      'Airtel Money': 'e.g. MP2401XXXX',
      '__other__': 'e.g. reference number'
    };
    paymentReferenceInput.placeholder = map[val] || 'Reference';
  }
}
paymentMethodSelect.addEventListener('change', onPaymentMethodChange);

document.querySelector('#orderForm').addEventListener('submit', e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.currentTarget));
  const items = orderRows().map(row => {
    const sel = row.querySelector('.order-combo-select');
    const [name, spec] = (sel.value || '').split('|||');
    const product = products.find(p => p.name.trim().toLowerCase() === (name || '').trim().toLowerCase());
    const quantity = Number(row.querySelector('.order-quantity').value) || 1;
    const unitPrice = Number(row.querySelector('.order-unit-price').value) || 0;
    return { name: name || '', product, specs: spec || '', quantity, unitPrice };
  });
  if (items.some(x => !x.name || !x.unitPrice)) { alert('Choose a product and price for each order line.'); return; }
  for (const it of items) {
    if (!it.product || it.product.category === 'Services') continue;
    const variants = Array.isArray(it.product.variantDetails) ? it.product.variantDetails : [];
    if (variants.length) {
      const v = variants.find(x => x.name === it.specs);
      if (!v) { alert(`Choose a spec for ${it.product.name}.`); return; }
      if (Number(v.stock) < it.quantity) { alert(`Only ${v.stock} ${it.product.unit || 'units'} of ${it.product.name} (${v.name}) available.`); return; }
    } else if (Number(it.product.stock) < it.quantity) {
      alert(`Only ${it.product.stock} ${it.product.unit || 'units'} of ${it.product.name} available.`); return;
    }
  }
  const amount = items.reduce((s,x) => s + x.quantity*x.unitPrice, 0);
  const quantity = items.reduce((s,x) => s + x.quantity, 0);
  const lines = items.map(x => ({ name: x.name, specs: x.specs||'', quantity: x.quantity, unitPrice: x.unitPrice }));
  const combinedSpecs = lines.map(l => l.specs).filter(Boolean).join('; ');

  // Resolve payment method + other + reference
  const rawMethod = d.paymentMethod || '';
  const isOther = rawMethod === '__other__';
  const paymentMethod = isOther ? 'Other' : rawMethod;
  const paymentOther = isOther ? (d.paymentOther || '').trim() : '';
  const reference = (d.mpesa || '').trim();

  const orderBase = {
    ...d,
    paymentMethod,
    paymentOther,
    mpesa: reference,
    item: items.map(x => x.quantity>1 ? `${x.name} (${x.quantity})` : x.name).join(', '),
    quantity,
    unitPrice: quantity ? amount/quantity : amount,
    amount, lines, specs: combinedSpecs
  };

  if (editingOrderId) {
    orders = orders.map(o => o.id === editingOrderId ? { ...o, ...orderBase, id: o.id } : o);
    editingOrderId = null;
  } else {
    orders.unshift({ ...orderBase, id: Date.now() });
  }

  items.forEach(x => {
    if (!x.product || x.product.category === 'Services') return;
    const variants = Array.isArray(x.product.variantDetails) ? x.product.variantDetails : [];
    if (variants.length) {
      const v = variants.find(vv => vv.name === x.specs);
      if (v) v.stock = Math.max(0, Number(v.stock) - x.quantity);
      x.product.stock = variants.reduce((s,vv) => s + (Number(vv.stock)||0), 0);
    } else {
      x.product.stock = Math.max(0, Number(x.product.stock) - x.quantity);
    }
  });

  upsertCustomer(d.customer, d.phone);
  syncAfterLocalChange(() => pushOrdersToCloud());
  e.currentTarget.reset();
  resetOrderItems();
  document.querySelector('#orderAmount').value = '';
  document.querySelector('#orderDialogTitle').textContent = 'Add an order';
  onPaymentMethodChange();
  orderDialog.close();
});

function openEditOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  editingOrderId = id;
  document.querySelector('#orderDialogTitle').textContent = 'Edit order';
  const form = document.querySelector('#orderForm');
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
    else el.value = '';
  });
  form.querySelector('[name="customer"]').value = o.customer || '';
  form.querySelector('[name="phone"]').value = o.phone || '';
  form.querySelector('[name="channel"]').value = o.channel || 'WhatsApp';
  form.querySelector('[name="notes"]').value = o.notes || '';
  form.querySelector('[name="status"]').value = o.status || 'pending';

  // Payment method restoration
  const storedMethod = o.paymentMethod || (o.mpesa ? 'M-Pesa' : 'Cash');
  if (storedMethod === 'Other') {
    paymentMethodSelect.value = '__other__';
    document.querySelector('#paymentOtherInput').value = o.paymentOther || '';
  } else {
    const has = [...paymentMethodSelect.options].some(op => op.value === storedMethod || op.textContent === storedMethod);
    if (has) paymentMethodSelect.value = storedMethod;
    else paymentMethodSelect.value = '__other__';
    document.querySelector('#paymentOtherInput').value = '';
  }
  paymentReferenceInput.value = o.mpesa || '';
  onPaymentMethodChange();

  document.querySelector('#saleDate').value = o.saleDate || new Date().toISOString().slice(0,10);

  const lines = Array.isArray(o.lines) && o.lines.length
    ? o.lines
    : [{ name: o.item, specs: o.specs || '', quantity: o.quantity || 1, unitPrice: o.unitPrice || o.amount }];

  const container = document.querySelector('#orderItems');
  container.innerHTML = '';
  renderProductCombo();

  lines.forEach(line => {
    const row = makeOrderItemRow();
    container.appendChild(row);
    renderProductCombo();
    const sel = row.querySelector('.order-combo-select');
    const product = products.find(p => p.name.trim().toLowerCase() === line.name.trim().toLowerCase());
    const variants = Array.isArray(product?.variantDetails) ? product.variantDetails : [];
    const v = variants.find(vv => vv.name === line.specs);
    let matchValue = '';
    if (product) matchValue = v ? `${product.name}|||${v.name}` : `${product.name}|||`;
    const hasOption = [...sel.options].some(op => op.value === matchValue);
    if (hasOption) sel.value = matchValue;
    row.querySelector('.order-quantity').value = line.quantity;
    row.querySelector('.order-unit-price').value = v ? v.price : line.unitPrice;
  });
  calculateOrderTotal();
  orderDialog.showModal();
}

document.querySelector('#ordersBody').addEventListener('click', async e => {
  const del = Number(e.target.dataset.delete), paid = Number(e.target.dataset.paid), receipt = Number(e.target.dataset.receipt), edit = Number(e.target.dataset.editOrder);
  if (del) {
    const order = orders.find(o => o.id === del);
    if (!order) return;
    const ok = await askConfirm({ title:'Delete this order?', message:`This will remove the order for ${order.customer} and restore any stock it used. If they have no other orders, their customer record will also be removed.`, confirmLabel:'Yes, delete order' });
    if (!ok) return;
    const lines = Array.isArray(order.lines) && order.lines.length ? order.lines : [{ name:order.item, specs:order.specs||'', quantity:order.quantity||1 }];
    lines.forEach(l => {
      const p = products.find(pp => pp.name.trim().toLowerCase() === String(l.name).trim().toLowerCase());
      if (!p || p.category === 'Services') return;
      const variants = Array.isArray(p.variantDetails) ? p.variantDetails : [];
      if (variants.length && l.specs) {
        const v = variants.find(vv => vv.name === l.specs);
        if (v) v.stock = (Number(v.stock)||0) + (Number(l.quantity)||1);
        p.stock = variants.reduce((s,vv) => s + (Number(vv.stock)||0), 0);
      } else if (!variants.length) {
        p.stock = (Number(p.stock)||0) + (Number(l.quantity)||1);
      }
    });
    orders = orders.filter(o => o.id !== del);
    const key = order.customer.trim().toLowerCase();
    if (!orders.some(o => o.customer.trim().toLowerCase() === key)) customers = customers.filter(c => c.name.trim().toLowerCase() !== key);
    syncAfterLocalChange(() => pushOrdersToCloud());
  }
  if (paid) { orders = orders.map(o => o.id === paid ? { ...o, status:'paid' } : o); syncAfterLocalChange(() => pushOrdersToCloud()); }
  if (receipt) showReceipt(receipt);
  if (edit) openEditOrder(edit);
});
document.querySelector('#ordersBody').addEventListener('change', e => {
  const id = Number(e.target.dataset.status);
  if (id) { orders = orders.map(o => o.id === id ? { ...o, status: e.target.value } : o); syncAfterLocalChange(() => pushOrdersToCloud()); }
});

document.querySelectorAll('.filter').forEach(b => b.addEventListener('click', () => {
  activeFilter = b.dataset.filter;
  document.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === b));
  render();
}));
document.querySelector('#orderSearch').addEventListener('input', e => { searchTerm = e.target.value.trim().toLowerCase(); render(); });
document.querySelector('#inventorySearch').addEventListener('input', e => { inventorySearchTerm = e.target.value.trim().toLowerCase(); renderInventory(); });
document.querySelector('#customerSearch').addEventListener('input', e => { customerSearchTerm = e.target.value.trim().toLowerCase(); renderCustomers(); });

// ============================================================
// Profile
// ============================================================
document.querySelector('#profileButton').addEventListener('click', () => {
  document.querySelector('#businessNameInput').value = profile.businessName;
  document.querySelector('#ownerNameInput').value = profile.ownerName;
  document.querySelector('#businessPhoneInput').value = profile.businessPhone;
  profileDialog.showModal();
});
document.querySelector('.close-profile').addEventListener('click', () => profileDialog.close());
document.querySelector('#avatarInput').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => { profile.photo = r.result; renderProfile(); }; r.readAsDataURL(f);
});
document.querySelector('#profileForm').addEventListener('submit', e => {
  e.preventDefault();
  profile = { ...profile, ...Object.fromEntries(new FormData(e.currentTarget)) };
  renderProfile();
  syncAfterLocalChange(() => pushProfileToCloud());
  profileDialog.close();
});

// ============================================================
// Product form (variants editor)
// ============================================================
function updateProductServiceFields() {
  const service = document.querySelector('#productCategoryInput').value === 'Services';
  document.querySelector('#productStockField').hidden = service;
  document.querySelector('#productStockInput').required = !service;
  document.querySelector('#variantSection').hidden = service;
  if (service) {
    document.querySelector('#productStockInput').value = 0;
    const unitSel = document.querySelector('#productUnitInput');
    if (unitSel) unitSel.value = 'session';
  }
}
function addVariantRow(name = '', price = '', stock = '') {
  const container = document.querySelector('#variantRows');
  const row = document.createElement('div');
  row.className = 'variant-edit-row';
  row.innerHTML = `<input class="variant-name" data-case="title" placeholder="Spec name (e.g. 9W warm)" value="${escapeHtml(name)}" /><input class="variant-price" type="number" min="0" placeholder="Price" value="${price !== '' ? price : ''}" /><input class="variant-stock" type="number" min="0" placeholder="Stock" value="${stock !== '' ? stock : ''}" /><button type="button" class="remove-variant" aria-label="Remove spec">×</button>`;
  container.appendChild(row);
}
document.querySelector('#variantRows').addEventListener('input', () => {
  const rows = [...document.querySelectorAll('#variantRows .variant-edit-row')];
  if (!rows.length) return;
  const total = rows.reduce((s,r) => s + (Number(r.querySelector('.variant-stock').value)||0), 0);
  document.querySelector('#productStockInput').value = total;
});
document.querySelector('#addVariant').addEventListener('click', () => addVariantRow());
document.querySelector('#variantRows').addEventListener('click', e => {
  if (e.target.matches('.remove-variant')) {
    e.target.closest('.variant-edit-row').remove();
    const rows = [...document.querySelectorAll('#variantRows .variant-edit-row')];
    const total = rows.reduce((s,r) => s + (Number(r.querySelector('.variant-stock').value)||0), 0);
    document.querySelector('#productStockInput').value = rows.length ? total : '';
  }
});
document.querySelector('#addProduct').addEventListener('click', () => {
  editingProductName = null;
  document.querySelector('#productDialogTitle').textContent = 'Add a product';
  document.querySelector('#productForm').reset();
  document.querySelector('#variantRows').innerHTML = '';
  updateProductServiceFields();
  productDialog.showModal();
});
document.querySelector('.close-product').addEventListener('click', () => productDialog.close());
document.querySelector('#productCategoryInput').addEventListener('change', updateProductServiceFields);
document.querySelector('#productForm').addEventListener('submit', e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.currentTarget));
  const service = d.category === 'Services';
  const variantDetails = [...document.querySelectorAll('#variantRows .variant-edit-row')].map(row => {
    const name = row.querySelector('.variant-name').value.trim();
    const price = Number(row.querySelector('.variant-price').value) || 0;
    const stock = Number(row.querySelector('.variant-stock').value) || 0;
    return name ? { name, price, stock } : null;
  }).filter(Boolean);
  const parentStock = variantDetails.length ? variantDetails.reduce((s,v) => s + v.stock, 0) : Number(d.stock);
  const details = {
    name: d.productName.trim(), category: d.category, sku: d.sku.trim(),
    unit: service ? 'service' : d.unit,
    variants: variantDetails.map(v => v.name).join(', '),
    variantDetails,
    price: variantDetails.length ? variantDetails[0].price : Number(d.price),
    stock: service ? 0 : parentStock
  };
  if (editingProductName) {
    const p = products.find(pp => pp.name.trim().toLowerCase() === editingProductName.trim().toLowerCase());
    if (p) Object.assign(p, details);
  } else products.unshift(details);
  editingProductName = null;
  save(); render();
  e.currentTarget.reset();
  document.querySelector('#variantRows').innerHTML = '';
  updateProductServiceFields();
  productDialog.close();
  if (cloudSession) pushProductsToCloud();
});

// ============================================================
// Inventory grid
// ============================================================
document.querySelector('#inventoryGrid').addEventListener('click', async e => {
  const toggle = e.target.dataset.toggleVariants;
  if (toggle) {
    const name = decodeURIComponent(toggle);
    if (collapsedProducts.includes(name)) collapsedProducts = collapsedProducts.filter(n => n !== name);
    else collapsedProducts.push(name);
    save(); renderInventory();
    return;
  }
  const restock = e.target.dataset.restockProduct;
  if (restock) {
    const name = decodeURIComponent(restock);
    const variantName = e.target.dataset.restockVariant ? decodeURIComponent(e.target.dataset.restockVariant) : null;
    const product = products.find(p => p.name === name);
    if (!product) return;
    openRestockDialog(product, variantName);
    return;
  }
  const edit = e.target.dataset.editProduct;
  if (edit) {
    const name = decodeURIComponent(edit);
    const product = products.find(p => p.name === name);
    if (!product) return;
    editingProductName = name;
    document.querySelector('#productDialogTitle').textContent = 'Edit product';
    document.querySelector('#productNameInput').value = product.name;
    document.querySelector('#productCategoryInput').value = product.category || 'Other';
    document.querySelector('#productSkuInput').value = product.sku || '';
    document.querySelector('#productPriceInput').value = product.price;
    document.querySelector('#productStockInput').value = product.stock;
    document.querySelector('#variantRows').innerHTML = '';
    (product.variantDetails || []).forEach(v => addVariantRow(v.name, v.price, v.stock));
    updateProductServiceFields();
    productDialog.showModal();
    return;
  }
  const remove = e.target.dataset.removeProduct;
  if (remove) {
    const name = decodeURIComponent(remove);
    const ok = await askConfirm({ title:'Remove this product?', message:`"${name}" will be removed from your stock list. Past orders that used it will stay.`, confirmLabel:'Yes, remove product' });
    if (!ok) return;
    products = products.filter(p => p.name !== name);
    save(); render();
    if (cloudSession) pushProductsToCloud();
  }
});

// ---------- Restock ----------
function openRestockDialog(product, preselectedVariant) {
  restockingProductName = product.name;
  document.querySelector('#restockProductName').textContent = product.name;
  const variants = Array.isArray(product.variantDetails) ? product.variantDetails : [];
  const total = productTotalStock(product);
  document.querySelector('#restockCurrentStock').textContent = `Current stock: ${total} ${product.unit || 'units'}`;

  document.querySelector('#newVariantName').value = '';
  document.querySelector('#newVariantPrice').value = '';
  document.querySelector('#newVariantStock').value = '';
  document.querySelector('.restock-new-variant').open = false;

  const variantsSection = document.querySelector('#restockVariantsSection');
  const noVariantsSection = document.querySelector('#restockNoVariantsSection');
  const rowsContainer = document.querySelector('#restockVariantRows');

  if (variants.length) {
    variantsSection.hidden = false;
    noVariantsSection.hidden = true;
    rowsContainer.innerHTML = variants.map(v => `
      <div class="restock-variant-row" data-variant="${escapeHtml(v.name)}">
        <div class="restock-variant-info">
          <b>${escapeHtml(v.name)}</b>
          <small>${v.stock} in stock · ${money(v.price)}</small>
        </div>
        <input type="number" min="0" class="restock-variant-amount" placeholder="+ units" aria-label="Units to add for ${escapeHtml(v.name)}" />
      </div>`).join('');
    if (preselectedVariant) {
      const rows = [...rowsContainer.querySelectorAll('.restock-variant-row')];
      const target = rows.find(r => r.dataset.variant === preselectedVariant);
      if (target) setTimeout(() => target.querySelector('.restock-variant-amount').focus(), 60);
    }
  } else {
    variantsSection.hidden = true;
    noVariantsSection.hidden = false;
    document.querySelector('#restockAmountSimple').value = '';
  }
  restockDialog.showModal();
}
document.querySelector('.close-restock').addEventListener('click', () => restockDialog.close());
document.querySelector('#restockForm').addEventListener('submit', e => {
  e.preventDefault();
  const product = products.find(p => p.name === restockingProductName);
  if (!product) { restockDialog.close(); return; }
  const variants = Array.isArray(product.variantDetails) ? product.variantDetails : [];
  let changed = false;

  document.querySelectorAll('.restock-variant-row').forEach(row => {
    const name = row.dataset.variant;
    const amount = Number(row.querySelector('.restock-variant-amount').value) || 0;
    if (amount > 0) {
      const v = variants.find(vv => vv.name === name);
      if (v) { v.stock = Number(v.stock) + amount; changed = true; }
    }
  });

  if (!variants.length) {
    const amount = Number(document.querySelector('#restockAmountSimple').value) || 0;
    if (amount > 0) { product.stock = Number(product.stock) + amount; changed = true; }
  }

  const newName = document.querySelector('#newVariantName').value.trim();
  const newPrice = Number(document.querySelector('#newVariantPrice').value) || 0;
  const newStock = Number(document.querySelector('#newVariantStock').value) || 0;
  if (newName) {
    const already = variants.find(vv => vv.name.toLowerCase() === newName.toLowerCase());
    if (already) { already.stock = Number(already.stock) + newStock; }
    else { variants.push({ name: newName, price: newPrice, stock: newStock }); }
    product.variantDetails = variants;
    product.variants = variants.map(v => v.name).join(', ');
    changed = true;
  }

  if (variants.length) product.stock = variants.reduce((s,vv) => s + (Number(vv.stock)||0), 0);

  if (changed) {
    save(); render();
    if (cloudSession) pushProductsToCloud();
    showInfo({ title: 'Stock updated', message: `${product.name} has been restocked.`, icon: '✓' });
  }
  restockingProductName = null;
  restockDialog.close();
});

// ============================================================
// Customers
// ============================================================
document.querySelector('#addCustomer').addEventListener('click', () => {
  editingCustomerName = null;
  document.querySelector('#customerDialogTitle').textContent = 'Add a customer';
  document.querySelector('#customerForm').reset();
  customerDialog.showModal();
});
document.querySelector('.close-customer').addEventListener('click', () => customerDialog.close());
document.querySelector('#customerList').addEventListener('click', e => {
  const encoded = e.target.dataset.editCustomer;
  if (!encoded) return;
  const oldName = decodeURIComponent(encoded), key = oldName.trim().toLowerCase();
  let customer = customers.find(c => c.name.trim().toLowerCase() === key);
  if (!customer) {
    const order = orders.find(o => o.customer.trim().toLowerCase() === key);
    customer = { name: oldName, phone: order?.phone || '', email:'', area:'', notes:'' };
    customers.push(customer);
  }
  editingCustomerName = oldName;
  document.querySelector('#customerDialogTitle').textContent = 'Edit customer';
  document.querySelector('#customerNameInput').value = customer.name;
  document.querySelector('#customerPhoneInput').value = customer.phone || '';
  document.querySelector('#customerEmailInput').value = customer.email || '';
  document.querySelector('#customerAreaInput').value = customer.area || '';
  document.querySelector('#customerNotesInput').value = customer.notes || '';
  customerDialog.showModal();
});
document.querySelector('#customerList').addEventListener('click', async e => {
  const encoded = e.target.dataset.removeCustomer;
  if (!encoded) return;
  const name = decodeURIComponent(encoded), key = name.trim().toLowerCase();
  const ok = await askConfirm({ title:'Remove this customer?', message:`"${name}" will be removed from your customer directory. Their past orders will stay in your records.`, confirmLabel:'Yes, remove customer' });
  if (!ok) return;
  customers = customers.filter(c => c.name.trim().toLowerCase() !== key);
  if (!hiddenCustomerKeys.includes(key)) hiddenCustomerKeys.push(key);
  syncAfterLocalChange(async () => { await pushCustomersToCloud(); await pushOrdersToCloud(); });
});
document.querySelector('#customerForm').addEventListener('submit', e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.currentTarget));
  const details = { name:d.customerName.trim(), phone:d.customerPhone, email:d.customerEmail, area:d.customerArea, notes:d.customerNotes };
  if (editingCustomerName) {
    const oldKey = editingCustomerName.trim().toLowerCase();
    const existing = customers.find(c => c.name.trim().toLowerCase() === oldKey);
    if (existing) Object.assign(existing, details);
    else customers.push(details);
    orders = orders.map(o => o.customer.trim().toLowerCase() === oldKey ? { ...o, customer:details.name, phone:details.phone||o.phone } : o);
  } else {
    const existing = customers.find(c => c.name.trim().toLowerCase() === details.name.toLowerCase());
    if (existing) Object.assign(existing, details);
    else customers.push(details);
  }
  hiddenCustomerKeys = hiddenCustomerKeys.filter(k => k !== details.name.trim().toLowerCase());
  editingCustomerName = null;
  syncAfterLocalChange(async () => { await pushCustomersToCloud(); await pushOrdersToCloud(); });
  e.currentTarget.reset();
  customerDialog.close();
});

document.querySelector('#lowStockLimit').addEventListener('input', e => {
  lowStockLimit = Math.max(0, Number(e.target.value) || 0);
  save(); renderInventory();
});

// ============================================================
// Theme
// ============================================================
function applyTheme(theme) {
  const effective = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = effective;
  localStorage.setItem('biasharaBridgeThemeChoice', theme);
  document.querySelectorAll('.appearance-option').forEach(button => button.classList.toggle('active', button.dataset.themeChoice === theme));
}
document.querySelectorAll('.appearance-option').forEach(button => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
applyTheme(localStorage.getItem('biasharaBridgeThemeChoice') || 'system');
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (localStorage.getItem('biasharaBridgeThemeChoice') === 'system') applyTheme('system');
});

// ============================================================
// Receipt
// ============================================================
function showReceipt(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  let linesHtml;
  if (Array.isArray(o.lines) && o.lines.length) {
    linesHtml = `<div class="receipt-lines">${o.lines.map(l =>
      `<div class="receipt-line"><b>${escapeHtml(l.name)}${l.specs ? ` - ${escapeHtml(l.specs)}` : ''} × ${l.quantity} = ${money(l.quantity * l.unitPrice)}</b></div>`
    ).join('')}</div>`;
  } else {
    linesHtml = `<p>Order: <b>${escapeHtml(o.item)}${o.specs ? ` - ${escapeHtml(o.specs)}` : ''} × ${o.quantity || 1} = ${money(o.amount)}</b></p>`;
  }
  const paymentLine = describePayment(o);
  document.querySelector('#receiptContent').innerHTML = `<p class="eyebrow">${escapeHtml(profile.businessName || 'Receipt')}</p><h2>Payment receipt</h2><p>Date sold: <b>${displayDate(o.saleDate)}</b></p><p>Customer: <b>${escapeHtml(o.customer)}</b></p>${linesHtml}${o.notes?`<p>Note: <b>${escapeHtml(o.notes)}</b></p>`:''}<p>Grand total: <b>${money(o.amount)}</b></p><p>Status: <b>${statusLabel[o.status]}</b></p>${paymentLine?`<p>Paid via: <b>${escapeHtml(paymentLine)}</b></p>`:''}<small>Thank you for supporting ${escapeHtml(profile.businessName || 'us')}.</small>`;
  receiptDialog.showModal();
}
document.querySelector('#closeReceipt').addEventListener('click', () => receiptDialog.close());
document.querySelector('#printReceipt').addEventListener('click', () => window.print());

// ============================================================
// Boot
// ============================================================
render(); renderProfile();
onPaymentMethodChange();
setTimeout(() => {
  if (!currentEmail) {
    maybeShowWelcome();
    setTimeout(maybeShowSignInReminder, 800);
  }
}, 400);
setInterval(updateGreeting, 60000);

// ============================================================
// Auto-open customer suggestion list on focus
// ============================================================
document.addEventListener('focusin', e => {
  if (e.target.matches && e.target.matches('input[list="customerOptions"]') && e.target.value === '') {
    setTimeout(() => {
      const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      e.target.dispatchEvent(ev);
    }, 40);
  }
});

// ============================================================
// Custom customer autocomplete
// ============================================================
(function wireCustomerAutocomplete(){
  const input = document.querySelector('#customerInput');
  const list = document.querySelector('#customerAutocomplete');
  if (!input || !list) return;

  let activeIndex = -1;

  function close(){ list.hidden = true; list.innerHTML = ''; activeIndex = -1; }

  function open(matches) {
    if (!matches.length) {
      list.innerHTML = `<div class="ac-empty">No saved customers yet — type a new name.</div>`;
      list.hidden = false;
      return;
    }
    list.innerHTML = `<div class="ac-group">Saved customers</div>` +
      matches.map((name, i) => `<button type="button" class="ac-option" data-name="${escapeHtml(name)}" data-index="${i}">${escapeHtml(name)}</button>`).join('');
    list.hidden = false;
    activeIndex = -1;
  }

  function getMatches(term) {
    const t = (term || '').trim().toLowerCase();
    const names = customers.map(c => c.name).filter(Boolean);
    if (!t) return names.slice(0, 8);
    return names.filter(n => n.toLowerCase().includes(t)).slice(0, 8);
  }

  input.addEventListener('focus', () => {
    open(getMatches(input.value));
  });

  input.addEventListener('input', () => {
    open(getMatches(input.value));
  });

  input.addEventListener('keydown', e => {
    const options = [...list.querySelectorAll('.ac-option')];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!options.length) return;
      activeIndex = (activeIndex + 1) % options.length;
      options.forEach((o, i) => o.classList.toggle('active', i === activeIndex));
      options[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      activeIndex = (activeIndex - 1 + options.length) % options.length;
      options.forEach((o, i) => o.classList.toggle('active', i === activeIndex));
      options[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && options[activeIndex]) {
        e.preventDefault();
        input.value = options[activeIndex].dataset.name;
        close();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  list.addEventListener('click', e => {
    const btn = e.target.closest('.ac-option');
    if (!btn) return;
    input.value = btn.dataset.name;
    close();
    input.focus();
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !list.contains(e.target)) close();
  });
})();

// ============================================================
// Mobile sidebar: backdrop, tap-to-close, toggle
// ============================================================
(function wireMobileSidebar(){
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.querySelector('#sidebarBackdrop');
  const toggle = document.querySelector('.menu-button');
  if (!sidebar || !backdrop || !toggle) return;

  function openSidebar(){
    sidebar.classList.add('open');
    backdrop.hidden = false;
    // Trigger the fade-in on the next frame
    requestAnimationFrame(() => backdrop.classList.add('visible'));
  }
  function closeSidebar(){
    sidebar.classList.remove('open');
    backdrop.classList.remove('visible');
    // Hide after the transition finishes
    setTimeout(() => {
      if (!sidebar.classList.contains('open')) backdrop.hidden = true;
    }, 220);
  }

  // Toggle on ☰
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
  });

  // Tap backdrop to close
  backdrop.addEventListener('click', closeSidebar);

  // Close when any nav link inside the sidebar is clicked
  sidebar.querySelectorAll('.nav-link, .back-dashboard').forEach(el => {
    el.addEventListener('click', () => closeSidebar());
  });

  // Close if the window is resized past mobile width
  window.addEventListener('resize', () => {
    if (window.innerWidth > 780 && sidebar.classList.contains('open')) closeSidebar();
  });
})();

// ============================================================
// Make floating + sidebar Add-order buttons work
// (the existing .add-order listener already runs, since
//  we use the same class — nothing more needed)
// ============================================================

// ============================================================
// Mobile bottom nav: "Top" scrolls back to the dashboard
// ============================================================
(function wireMobileTop(){
  const btn = document.querySelector('#mobileTopBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// ============================================================
// ☰ button — desktop: toggle sidebar visible/hidden
//              mobile: open/close sidebar with backdrop
// ============================================================
(function wireMenuButton(){
  const btn = document.querySelector('.menu-button');
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.querySelector('#sidebarBackdrop');
  if (!btn || !sidebar) return;

  const isMobile = () => window.matchMedia('(max-width:780px)').matches;

  function openMobile(){
    sidebar.classList.add('open');
    if (backdrop) {
      backdrop.hidden = false;
      requestAnimationFrame(() => backdrop.classList.add('visible'));
    }
  }
  function closeMobile(){
    sidebar.classList.remove('open');
    if (backdrop) {
      backdrop.classList.remove('visible');
      setTimeout(() => { if (!sidebar.classList.contains('open')) backdrop.hidden = true; }, 220);
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isMobile()) {
      sidebar.classList.contains('open') ? closeMobile() : openMobile();
    } else {
      sidebar.classList.toggle('sidebar-hidden-desktop');
    }
  });

  if (backdrop) backdrop.addEventListener('click', closeMobile);

  sidebar.querySelectorAll('.nav-link, .back-dashboard').forEach(el => {
    el.addEventListener('click', () => { if (isMobile()) closeMobile(); });
  });

  window.addEventListener('resize', () => {
    if (isMobile()) {
      sidebar.classList.remove('sidebar-hidden-desktop');
    } else {
      sidebar.classList.remove('open');
      if (backdrop) { backdrop.classList.remove('visible'); backdrop.hidden = true; }
    }
  });
})();

// ============================================================
// Desktop back-to-top button
// ============================================================
(function wireBackToTop(){
  let btn = document.querySelector('.back-to-top');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', 'Back to top');
    btn.textContent = '↑';
    document.body.appendChild(btn);
  }
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function update(){
    if (window.matchMedia('(max-width:780px)').matches) {
      btn.classList.remove('visible');
      return;
    }
    if (window.scrollY > 500) btn.classList.add('visible');
    else btn.classList.remove('visible');
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();

// ============================================================
// Mobile bottom nav: "Top" scrolls to top
// ============================================================
(function wireMobileTop(){
  const btn = document.querySelector('#mobileTopBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// ============================================================
// Sidebar scroll-sync with the page (desktop only, when visible)
// ============================================================
(function syncSidebarScroll(){
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const isDesktop = () => window.matchMedia('(min-width:781px)').matches;
  const isVisible = () => !sidebar.classList.contains('is-hidden');

  let ticking = false;

  function syncScroll(){
    if (!isDesktop() || !isVisible()) return;

    // Total scrollable height of the page
    const pageScrollable = document.documentElement.scrollHeight - window.innerHeight;
    // Total scrollable height inside the sidebar
    const sidebarScrollable = sidebar.scrollHeight - sidebar.clientHeight;

    // If there's nothing to scroll on either side, do nothing
    if (pageScrollable <= 0 || sidebarScrollable <= 0) return;

    // How far along the page journey we are (0 → 1)
    const progress = Math.min(1, Math.max(0, window.scrollY / pageScrollable));

    // Match the sidebar proportionally
    sidebar.scrollTop = progress * sidebarScrollable;
  }

  function onScroll(){
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      syncScroll();
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  // Re-sync whenever the sidebar is toggled open
  const observer = new MutationObserver(() => {
    if (isVisible()) syncScroll();
  });
  observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });

  // Initial sync
  syncScroll();
})();