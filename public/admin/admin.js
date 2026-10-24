/**
 * Admin Panel Client - Admission Enquiry Dashboard
 * Handles live stats, logs filtering, CSV export, and FAQ CRUD with auto embedding reloads.
 */

// State
let allFaqs = [];
let searchDebounceTimer = null;

// DOM Elements
const statTotalQuestions = document.getElementById('statTotalQuestions');
const statAnsweredPercent = document.getElementById('statAnsweredPercent');
const statAnsweredCount = document.getElementById('statAnsweredCount');
const statHandedOffPercent = document.getElementById('statHandedOffPercent');
const statHandedOffCount = document.getElementById('statHandedOffCount');
const statTotalFaqs = document.getElementById('statTotalFaqs');
const statThresholdInfo = document.getElementById('statThresholdInfo');

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

const logsTableBody = document.getElementById('logsTableBody');
const logSearchInput = document.getElementById('logSearchInput');
const logStatusFilter = document.getElementById('logStatusFilter');
const logChannelFilter = document.getElementById('logChannelFilter');
const refreshLogsBtn = document.getElementById('refreshLogsBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');

const handoffListContainer = document.getElementById('handoffListContainer');
const refreshHandoffsBtn = document.getElementById('refreshHandoffsBtn');

const faqsTableBody = document.getElementById('faqsTableBody');
const faqSearchInput = document.getElementById('faqSearchInput');
const openAddFaqModalBtn = document.getElementById('openAddFaqModalBtn');

const faqModal = document.getElementById('faqModal');
const faqModalTitle = document.getElementById('faqModalTitle');
const faqModalForm = document.getElementById('faqModalForm');
const modalFaqId = document.getElementById('modalFaqId');
const modalQuestion = document.getElementById('modalQuestion');
const modalAnswer = document.getElementById('modalAnswer');
const closeFaqModalBtn = document.getElementById('closeFaqModalBtn');
const cancelFaqModalBtn = document.getElementById('cancelFaqModalBtn');
const saveFaqBtn = document.getElementById('saveFaqBtn');

const toastContainer = document.getElementById('toastContainer');

// ==========================================
// Toast Notifications
// ==========================================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : '⚠️'}</span>
    <span>${message}</span>
  `;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
// API Helpers
// ==========================================
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (res.status === 401) {
      window.location.href = '/admin/login';
      return null;
    }
    return res;
  } catch (err) {
    console.error('API Fetch error:', err);
    showToast('Network error connecting to admin API', 'error');
    return null;
  }
}

// ==========================================
// Stats Loader
// ==========================================
async function loadStats() {
  const res = await apiFetch('/admin/api/stats');
  if (!res || !res.ok) return;

  const data = await res.json();
  statTotalQuestions.textContent = data.totalQuestions;
  statAnsweredPercent.textContent = `${data.answeredPercent}%`;
  statAnsweredCount.textContent = `${data.answeredCount} questions resolved`;
  statHandedOffPercent.textContent = `${data.handedOffPercent}%`;
  statHandedOffCount.textContent = `${data.handedOffCount} questions routed`;
  statTotalFaqs.textContent = data.totalFaqs;
  statThresholdInfo.textContent = `Threshold: ${data.threshold} • DB: ${data.databaseProvider.toUpperCase()}`;
}

// ==========================================
// TAB 1: Enquiry Logs
// ==========================================
async function loadLogs() {
  const search = encodeURIComponent(logSearchInput.value.trim());
  const status = logStatusFilter.value;
  const channel = logChannelFilter.value;

  const url = `/admin/api/logs?status=${status}&channel=${channel}&search=${search}&limit=100`;
  const res = await apiFetch(url);
  if (!res || !res.ok) return;

  const data = await res.json();
  renderLogsTable(data.logs);
}

function renderLogsTable(logs) {
  if (!logs || logs.length === 0) {
    logsTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-4 text-muted">
          No admission enquiries found matching the filters.
        </td>
      </tr>
    `;
    return;
  }

  logsTableBody.innerHTML = logs.map(item => {
    const isAnswered = item.status === 'answered';
    const statusBadge = isAnswered 
      ? '<span class="badge badge-success">Answered</span>' 
      : '<span class="badge badge-warning">Handed Off</span>';
    
    const channelBadge = `<span class="badge badge-secondary">${escapeHtml(item.channel || 'web')}</span>`;
    const langBadge = `<span class="score-tag">${escapeHtml(item.language || 'en-IN')}</span>`;
    const scoreVal = typeof item.score === 'number' ? item.score.toFixed(4) : item.score;
    const timeFormatted = formatTimestamp(item.timestamp);

    return `
      <tr>
        <td><strong>#${item.id}</strong></td>
        <td class="text-muted" style="font-size: 0.78rem;">${timeFormatted}</td>
        <td>${channelBadge}</td>
        <td>${langBadge}</td>
        <td><strong>${escapeHtml(item.question_text)}</strong></td>
        <td class="text-muted">${item.matched_faq ? escapeHtml(item.matched_faq) : '<em>None</em>'}</td>
        <td><span class="score-tag">${scoreVal}</span></td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

// ==========================================
// TAB 2: Handed-Off Queries (FAQ Gaps)
// ==========================================
async function loadHandedOffQueries() {
  const res = await apiFetch('/admin/api/handed-off?limit=100');
  if (!res || !res.ok) return;

  const data = await res.json();
  renderHandedOffList(data.logs);
}

function renderHandedOffList(logs) {
  if (!logs || logs.length === 0) {
    handoffListContainer.innerHTML = `
      <div class="text-center py-4 text-muted">
        🎉 No handed-off enquiries yet! All user queries were matched by the AI assistant.
      </div>
    `;
    return;
  }

  handoffListContainer.innerHTML = logs.map(item => {
    const timeFormatted = formatTimestamp(item.timestamp);
    const scoreVal = typeof item.score === 'number' ? item.score.toFixed(4) : item.score;

    return `
      <div class="handoff-item">
        <div class="handoff-info">
          <div class="handoff-q">"${escapeHtml(item.question_text)}"</div>
          <div class="handoff-meta">
            Asked via <strong>${escapeHtml(item.channel)}</strong> (${escapeHtml(item.language)}) on ${timeFormatted} • Highest score was only <span class="score-tag">${scoreVal}</span> (matched: "${escapeHtml(item.matched_faq || 'None')}")
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-sm add-as-faq-btn" data-question="${escapeHtml(item.question_text)}">
          ➕ Add to FAQ
        </button>
      </div>
    `;
  }).join('');

  // Attach 1-click Add to FAQ handlers
  document.querySelectorAll('.add-as-faq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.question;
      openFaqModal({ question: q, answer: '' });
    });
  });
}

// ==========================================
// TAB 3: FAQ Knowledge Base Management
// ==========================================
async function loadFaqs() {
  const res = await apiFetch('/admin/api/faqs');
  if (!res || !res.ok) return;

  const data = await res.json();
  allFaqs = data.faqs || [];
  renderFaqsTable(allFaqs);
}

function renderFaqsTable(faqs) {
  const query = faqSearchInput.value.trim().toLowerCase();
  const filtered = query 
    ? faqs.filter(f => f.question.toLowerCase().includes(query) || f.answer.toLowerCase().includes(query))
    : faqs;

  if (filtered.length === 0) {
    faqsTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-4 text-muted">
          No FAQs match "${escapeHtml(query)}".
        </td>
      </tr>
    `;
    return;
  }

  faqsTableBody.innerHTML = filtered.map(f => {
    const truncatedAnswer = f.answer.length > 120 ? f.answer.substring(0, 117) + '...' : f.answer;

    return `
      <tr>
        <td><strong>#${f.id}</strong></td>
        <td><strong>${escapeHtml(f.question)}</strong></td>
        <td class="text-muted" title="${escapeHtml(f.answer)}">${escapeHtml(truncatedAnswer)}</td>
        <td>
          <div style="display: flex; gap: 0.35rem;">
            <button type="button" class="btn btn-secondary btn-sm edit-faq-btn" data-id="${f.id}">
              ✏️ Edit
            </button>
            <button type="button" class="btn btn-danger btn-sm delete-faq-btn" data-id="${f.id}" data-q="${escapeHtml(f.question)}">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Attach Edit and Delete buttons
  document.querySelectorAll('.edit-faq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const faq = allFaqs.find(item => item.id === id);
      if (faq) openFaqModal(faq);
    });
  });

  document.querySelectorAll('.delete-faq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const q = btn.dataset.q;
      handleDeleteFaq(id, q);
    });
  });
}

function openFaqModal(faq = null) {
  if (faq && faq.id) {
    faqModalTitle.textContent = `Edit FAQ #${faq.id}`;
    modalFaqId.value = faq.id;
    modalQuestion.value = faq.question;
    modalAnswer.value = faq.answer;
    saveFaqBtn.textContent = 'Update & Reload Embeddings';
  } else {
    faqModalTitle.textContent = 'Add New FAQ Entry';
    modalFaqId.value = '';
    modalQuestion.value = faq?.question || '';
    modalAnswer.value = faq?.answer || '';
    saveFaqBtn.textContent = 'Save & Reload Embeddings';
  }

  faqModal.style.display = 'flex';
  modalQuestion.focus();
}

function closeFaqModal() {
  faqModal.style.display = 'none';
  faqModalForm.reset();
  modalFaqId.value = '';
}

async function handleDeleteFaq(id, questionText) {
  if (!confirm(`Are you sure you want to delete this FAQ?\n\n"${questionText}"\n\nVector embeddings will be recomputed automatically.`)) {
    return;
  }

  showToast('Deleting FAQ and recomputing embeddings...', 'success');

  const res = await apiFetch(`/admin/api/faqs/${id}`, { method: 'DELETE' });
  if (res && res.ok) {
    const data = await res.json();
    showToast(`FAQ deleted! ${data.totalFaqs} FAQs active with updated embeddings.`, 'success');
    loadFaqs();
    loadStats();
  } else {
    showToast('Failed to delete FAQ.', 'error');
  }
}

// ==========================================
// CSV Export
// ==========================================
function handleExportCsv() {
  const status = logStatusFilter.value;
  const channel = logChannelFilter.value;
  const url = `/admin/api/export-csv?status=${status}&channel=${channel}`;
  window.location.href = url;
}

// ==========================================
// Utilities
// ==========================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTimestamp(isoStr) {
  if (!isoStr) return '--';
  const d = new Date(isoStr);
  return d.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// ==========================================
// Event Listeners
// ==========================================

// Tabs Switching
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const targetTab = btn.dataset.tab;
    document.getElementById(targetTab).classList.add('active');

    if (targetTab === 'logsTab') loadLogs();
    if (targetTab === 'handoffsTab') loadHandedOffQueries();
    if (targetTab === 'faqsTab') loadFaqs();
  });
});

// Logs Filters
logSearchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(loadLogs, 250);
});
logStatusFilter.addEventListener('change', loadLogs);
logChannelFilter.addEventListener('change', loadLogs);
refreshLogsBtn.addEventListener('click', () => {
  loadLogs();
  loadStats();
  showToast('Logs refreshed', 'success');
});
exportCsvBtn.addEventListener('click', handleExportCsv);
refreshHandoffsBtn.addEventListener('click', loadHandedOffQueries);

// FAQ Search & Modal
faqSearchInput.addEventListener('input', () => renderFaqsTable(allFaqs));
openAddFaqModalBtn.addEventListener('click', () => openFaqModal());
closeFaqModalBtn.addEventListener('click', closeFaqModal);
cancelFaqModalBtn.addEventListener('click', closeFaqModal);

faqModal.addEventListener('click', (e) => {
  if (e.target === faqModal) closeFaqModal();
});

// FAQ Form Submission (Create or Edit)
faqModalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = modalFaqId.value;
  const q = modalQuestion.value.trim();
  const a = modalAnswer.value.trim();

  if (!q || !a) return;

  saveFaqBtn.disabled = true;
  saveFaqBtn.textContent = 'Recomputing Embeddings...';

  const isEdit = Boolean(id);
  const url = isEdit ? `/admin/api/faqs/${id}` : '/admin/api/faqs';
  const method = isEdit ? 'PUT' : 'POST';

  const res = await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: q, answer: a })
  });

  saveFaqBtn.disabled = false;
  saveFaqBtn.textContent = 'Save & Reload Embeddings';

  if (res && res.ok) {
    const data = await res.json();
    closeFaqModal();
    showToast(`FAQ ${isEdit ? 'updated' : 'added'}! Recomputed ${data.totalFaqs} embeddings.`, 'success');
    loadFaqs();
    loadStats();
  } else {
    showToast('Failed to save FAQ entry.', 'error');
  }
});

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadLogs();
});
