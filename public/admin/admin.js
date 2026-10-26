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
const faqStatusFilter = document.getElementById('faqStatusFilter');
const openAddFaqModalBtn = document.getElementById('openAddFaqModalBtn');

const faqModal = document.getElementById('faqModal');
const faqModalTitle = document.getElementById('faqModalTitle');
const faqModalForm = document.getElementById('faqModalForm');
const modalFaqId = document.getElementById('modalFaqId');
const modalQuestion = document.getElementById('modalQuestion');
const modalQuestionHi = document.getElementById('modalQuestionHi');
const modalAnswer = document.getElementById('modalAnswer');
const modalAnswerEnSpoken = document.getElementById('modalAnswerEnSpoken');
const modalAnswerHiSpoken = document.getElementById('modalAnswerHiSpoken');
const modalReviewStatus = document.getElementById('modalReviewStatus');
const closeFaqModalBtn = document.getElementById('closeFaqModalBtn');
const cancelFaqModalBtn = document.getElementById('cancelFaqModalBtn');
const saveFaqBtn = document.getElementById('saveFaqBtn');

const toastContainer = document.getElementById('toastContainer');

// ==========================================
// Staff Helpline DOM Elements
// ==========================================
let allStaff = [];
const staffTableBody = document.getElementById('staffTableBody');
const openAddStaffModalBtn = document.getElementById('openAddStaffModalBtn');
const refreshStaffBtn = document.getElementById('refreshStaffBtn');
const staffModal = document.getElementById('staffModal');
const staffModalTitle = document.getElementById('staffModalTitle');
const staffModalForm = document.getElementById('staffModalForm');
const modalStaffId = document.getElementById('modalStaffId');
const modalStaffName = document.getElementById('modalStaffName');
const modalStaffPhone = document.getElementById('modalStaffPhone');
const modalStaffPriority = document.getElementById('modalStaffPriority');
const modalStaffActive = document.getElementById('modalStaffActive');
const closeStaffModalBtn = document.getElementById('closeStaffModalBtn');
const cancelStaffModalBtn = document.getElementById('cancelStaffModalBtn');
const saveStaffBtn = document.getElementById('saveStaffBtn');

// ==========================================
// Schedule & Office Hours DOM Elements
// ==========================================
let holidaysList = [];
const scheduleSettingsForm = document.getElementById('scheduleSettingsForm');
const settingOfficeStart = document.getElementById('settingOfficeStart');
const settingOfficeEnd = document.getElementById('settingOfficeEnd');
const settingOfficeTz = document.getElementById('settingOfficeTz');
const settingHolidays = document.getElementById('settingHolidays');
const newHolidayDate = document.getElementById('newHolidayDate');
const newHolidayName = document.getElementById('newHolidayName');
const addHolidayBtn = document.getElementById('addHolidayBtn');
const holidaysListContainer = document.getElementById('holidaysListContainer');
const settingMaxAttempts = document.getElementById('settingMaxAttempts');
const settingStaffTimeout = document.getElementById('settingStaffTimeout');
const settingMaxCallerTransfers = document.getElementById('settingMaxCallerTransfers');
const saveScheduleBtn = document.getElementById('saveScheduleBtn');

// ==========================================
// Callbacks & Privacy DOM Elements
// ==========================================
const callbacksTableBody = document.getElementById('callbacksTableBody');
const callbackStatusFilter = document.getElementById('callbackStatusFilter');
const refreshCallbacksBtn = document.getElementById('refreshCallbacksBtn');
const decryptModal = document.getElementById('decryptModal');
const closeDecryptModalBtn = document.getElementById('closeDecryptModalBtn');
const dismissDecryptModalBtn = document.getElementById('dismissDecryptModalBtn');
const decryptedPhoneValue = document.getElementById('decryptedPhoneValue');
const copyDecryptedPhoneBtn = document.getElementById('copyDecryptedPhoneBtn');
const telDecryptedLink = document.getElementById('telDecryptedLink');

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
    
    const isLlm = item.llm_used === 1 || item.llm_used === true || item.llm_used === '1';
    const llmBadge = isLlm ? '<span class="badge" style="background: rgba(147, 51, 234, 0.2); color: #c084fc; border: 1px solid rgba(147, 51, 234, 0.4); margin-left: 4px;" title="Processed by Gemini LLM">✨ LLM</span>' : '';

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
        <td>${statusBadge} ${llmBadge}</td>
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
  const statusFilter = faqStatusFilter ? faqStatusFilter.value : 'all';

  let filtered = faqs;
  if (statusFilter !== 'all') {
    filtered = filtered.filter(f => (f.review_status || 'draft') === statusFilter);
  }
  if (query) {
    filtered = filtered.filter(f => 
      f.question.toLowerCase().includes(query) ||
      (f.question_hi && f.question_hi.toLowerCase().includes(query)) ||
      f.answer.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    faqsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-4 text-muted">
          No FAQs match current filter/search.
        </td>
      </tr>
    `;
    return;
  }

  faqsTableBody.innerHTML = filtered.map(f => {
    const isDraft = (f.review_status || 'draft') === 'draft';
    const statusBadge = isDraft
      ? `<span style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.35); padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; white-space: nowrap;">⚠️ Draft</span>`
      : `<span style="background: rgba(16, 185, 129, 0.15); color: #059669; border: 1px solid rgba(16, 185, 129, 0.35); padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; white-space: nowrap;">✅ Approved</span>`;

    const truncatedAnswer = f.answer.length > 95 ? f.answer.substring(0, 92) + '...' : f.answer;
    const spokenHiInfo = f.answer_hi_spoken ? `<div style="font-size: 11px; color: #4b5563; margin-top: 4px;"><strong>🗣️ Hi:</strong> ${escapeHtml(f.answer_hi_spoken.length > 70 ? f.answer_hi_spoken.substring(0, 67) + '...' : f.answer_hi_spoken)}</div>` : '';

    return `
      <tr>
        <td><strong>#${f.id}</strong></td>
        <td>
          <div style="font-weight: 600;">${escapeHtml(f.question)}</div>
          ${f.question_hi ? `<div style="font-size: 12px; color: #4338ca; margin-top: 3px;">🇮🇳 ${escapeHtml(f.question_hi)}</div>` : ''}
        </td>
        <td>${statusBadge}</td>
        <td>
          <div class="text-muted" title="${escapeHtml(f.answer)}">${escapeHtml(truncatedAnswer)}</div>
          ${spokenHiInfo}
        </td>
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
    modalQuestion.value = faq.question || '';
    modalQuestionHi.value = faq.question_hi || '';
    modalAnswer.value = faq.answer || '';
    modalAnswerEnSpoken.value = faq.answer_en_spoken || '';
    modalAnswerHiSpoken.value = faq.answer_hi_spoken || '';
    modalReviewStatus.value = faq.review_status || 'draft';
    saveFaqBtn.textContent = 'Update & Reload Embeddings';
  } else {
    faqModalTitle.textContent = 'Add New FAQ Entry';
    modalFaqId.value = '';
    modalQuestion.value = faq?.question || '';
    modalQuestionHi.value = faq?.question_hi || '';
    modalAnswer.value = faq?.answer || '';
    modalAnswerEnSpoken.value = faq?.answer_en_spoken || '';
    modalAnswerHiSpoken.value = faq?.answer_hi_spoken || '';
    modalReviewStatus.value = faq?.review_status || 'draft';
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
// TAB 4: Staff Numbers Management
// ==========================================
async function loadStaff() {
  if (!staffTableBody) return;
  staffTableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4">Loading staff numbers...</td></tr>';
  const res = await apiFetch('/admin/api/staff');
  if (!res || !res.ok) return;
  const data = await res.json();
  allStaff = data.staff || [];
  renderStaffTable(allStaff);
}

function renderStaffTable(staffList) {
  if (!staffTableBody) return;
  if (!staffList.length) {
    staffTableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No staff numbers configured yet. Click "Add Staff Number" to configure dialing order.</td></tr>';
    return;
  }

  staffTableBody.innerHTML = staffList.map((s, index) => {
    const isActive = Boolean(s.is_active);
    const activeBadge = isActive 
      ? `<span class="badge badge-success" style="cursor: pointer;" onclick="toggleStaffStatus('${s.id}', false)">🟢 Active</span>`
      : `<span class="badge badge-warning" style="cursor: pointer;" onclick="toggleStaffStatus('${s.id}', true)">⚪ Inactive</span>`;

    return `
      <tr>
        <td style="font-weight: 700; color: #818cf8;">
          <span style="display: inline-block; background: #1e293b; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">#${s.priority}</span>
        </td>
        <td style="font-weight: 600;">${escapeHtml(s.name)}</td>
        <td style="font-family: monospace; letter-spacing: 0.05em; font-weight: 600;">${escapeHtml(s.phone_number_masked || '***')}</td>
        <td>${activeBadge}</td>
        <td>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="openStaffModalForEdit('${s.id}')">✏️ Edit</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="moveStaffOrder('${s.id}', -1)" ${index === 0 ? 'disabled' : ''} title="Move Up in priority">⬆️</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="moveStaffOrder('${s.id}', 1)" ${index === staffList.length - 1 ? 'disabled' : ''} title="Move Down in priority">⬇️</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="deleteStaff('${s.id}', '${escapeHtml(s.name)}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openStaffModal(staff = null) {
  if (!staffModal) return;
  if (staff) {
    staffModalTitle.textContent = 'Edit Staff Member';
    modalStaffId.value = staff.id;
    modalStaffName.value = staff.name || '';
    modalStaffPhone.value = '';
    modalStaffPhone.placeholder = staff.phone_number_masked ? `Leave blank to keep current (${staff.phone_number_masked})` : '+91...';
    modalStaffPhone.required = false;
    modalStaffPriority.value = staff.priority || 1;
    modalStaffActive.value = staff.is_active ? '1' : '0';
  } else {
    staffModalTitle.textContent = 'Add Staff Number';
    modalStaffId.value = '';
    modalStaffName.value = '';
    modalStaffPhone.value = '';
    modalStaffPhone.placeholder = 'e.g. +915512273901 or +919876543210';
    modalStaffPhone.required = true;
    modalStaffPriority.value = (allStaff.length > 0 ? Math.max(...allStaff.map(s => s.priority || 0)) + 1 : 1);
    modalStaffActive.value = '1';
  }
  staffModal.style.display = 'flex';
}

function closeStaffModal() {
  if (staffModal) staffModal.style.display = 'none';
}

window.openStaffModalForEdit = function(id) {
  const staff = allStaff.find(s => s.id === id);
  if (staff) openStaffModal(staff);
};

window.toggleStaffStatus = async function(id, newStatus) {
  const res = await apiFetch(`/admin/api/staff/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: newStatus })
  });
  if (res && res.ok) {
    showToast(`Staff member ${newStatus ? 'activated' : 'deactivated'}`, 'success');
    loadStaff();
  }
};

window.deleteStaff = async function(id, name) {
  if (!confirm(`Are you sure you want to remove "${name}" from the dialing sequence?`)) return;
  const res = await apiFetch(`/admin/api/staff/${id}`, { method: 'DELETE' });
  if (res && res.ok) {
    showToast('Staff member deleted', 'success');
    loadStaff();
  }
};

window.moveStaffOrder = async function(id, direction) {
  const idx = allStaff.findIndex(s => s.id === id);
  if (idx < 0) return;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= allStaff.length) return;

  const newStaffList = [...allStaff];
  const temp = newStaffList[idx];
  newStaffList[idx] = newStaffList[targetIdx];
  newStaffList[targetIdx] = temp;

  const orderedIds = newStaffList.map(s => s.id);
  const res = await apiFetch('/admin/api/staff/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds })
  });
  if (res && res.ok) {
    showToast('Dial sequence order updated', 'success');
    loadStaff();
  }
};

// Staff Form Submission
staffModalForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = modalStaffId.value;
  const name = modalStaffName.value.trim();
  const phone = modalStaffPhone.value.trim();
  const priority = parseInt(modalStaffPriority.value, 10) || 1;
  const is_active = modalStaffActive.value === '1';

  if (!name) return;
  if (!id && !phone) return;

  saveStaffBtn.disabled = true;
  saveStaffBtn.textContent = 'Saving...';

  const isEdit = Boolean(id);
  const url = isEdit ? `/admin/api/staff/${id}` : '/admin/api/staff';
  const method = isEdit ? 'PUT' : 'POST';

  const payload = { name, priority, is_active };
  if (phone) payload.phone_number = phone;

  const res = await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  saveStaffBtn.disabled = false;
  saveStaffBtn.textContent = 'Save Staff Member';

  if (res && res.ok) {
    closeStaffModal();
    showToast(`Staff member ${isEdit ? 'updated' : 'added'} successfully!`, 'success');
    loadStaff();
  } else {
    showToast('Failed to save staff member.', 'error');
  }
});

// ==========================================
// TAB 4 (Section 2): Schedule & Office Hours
// ==========================================
function renderHolidaysList() {
  if (!holidaysListContainer) return;
  if (!holidaysList.length) {
    holidaysListContainer.innerHTML = '<span style="color: #64748b; font-size: 0.85rem;">No holidays added yet. Pick a date above to add one.</span>';
    if (settingHolidays) settingHolidays.value = '';
    return;
  }

  holidaysListContainer.innerHTML = holidaysList.map((h, idx) => `
    <div style="background: #1e293b; border: 1px solid #334155; padding: 0.35rem 0.75rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.85rem;">
      <span style="font-weight: 600; color: #38bdf8;">📅 ${escapeHtml(h.date)}</span>
      ${h.name ? `<span style="color: #cbd5e1;">(${escapeHtml(h.name)})</span>` : ''}
      <button type="button" onclick="removeHoliday(${idx})" style="background: none; border: none; color: #ef4444; font-weight: bold; cursor: pointer; padding: 0 0.25rem; font-size: 1rem; line-height: 1;" title="Remove this holiday date">✕</button>
    </div>
  `).join('');

  if (settingHolidays) {
    settingHolidays.value = holidaysList.map(h => h.date).join(',');
  }
}

window.removeHoliday = function(idx) {
  if (idx >= 0 && idx < holidaysList.length) {
    const removed = holidaysList.splice(idx, 1)[0];
    renderHolidaysList();
    showToast(`Removed holiday: ${removed.date}`, 'success');
  }
};

function handleAddHoliday() {
  if (!newHolidayDate || !newHolidayDate.value) {
    showToast('Please select a calendar date first.', 'error');
    newHolidayDate?.focus();
    return;
  }

  const dateVal = newHolidayDate.value.trim();
  const nameVal = newHolidayName ? newHolidayName.value.trim() : '';

  // Check duplicate
  if (holidaysList.some(h => h.date === dateVal)) {
    showToast(`Holiday date ${dateVal} is already added.`, 'error');
    return;
  }

  holidaysList.push({ date: dateVal, name: nameVal });
  // Sort chronologically
  holidaysList.sort((a, b) => a.date.localeCompare(b.date));

  renderHolidaysList();
  newHolidayDate.value = '';
  if (newHolidayName) newHolidayName.value = '';
  showToast(`Added holiday: ${dateVal} ${nameVal ? '(' + nameVal + ')' : ''}`, 'success');
}

async function loadScheduleSettings() {
  if (!scheduleSettingsForm) return;
  const res = await apiFetch('/admin/api/settings');
  if (!res || !res.ok) return;
  const data = await res.json();
  const settings = data.settings || {};

  if (settings.office_hours_start) settingOfficeStart.value = settings.office_hours_start;
  if (settings.office_hours_end) settingOfficeEnd.value = settings.office_hours_end;
  if (settings.max_staff_attempts) settingMaxAttempts.value = settings.max_staff_attempts;
  if (settings.staff_dial_timeout_seconds) settingStaffTimeout.value = settings.staff_dial_timeout_seconds;
  if (settings.max_caller_transfers) settingMaxCallerTransfers.value = settings.max_caller_transfers;

  // Known standard holiday names map
  const standardNames = {
    '2026-01-26': 'Republic Day',
    '2026-08-15': 'Independence Day',
    '2026-10-02': 'Gandhi Jayanti',
    '2026-11-08': 'Diwali'
  };

  const rawHolidays = settings.holidays || '2026-01-26,2026-08-15,2026-10-02';
  holidaysList = [];

  if (rawHolidays.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(rawHolidays);
      if (Array.isArray(parsed)) {
        holidaysList = parsed.map(item => typeof item === 'object' ? item : { date: String(item), name: standardNames[item] || '' });
      }
    } catch {
      // Fall through to CSV
    }
  }

  if (!holidaysList.length) {
    const dates = rawHolidays.split(',').map(s => s.trim()).filter(Boolean);
    holidaysList = dates.map(d => ({ date: d, name: standardNames[d] || '' }));
  }

  renderHolidaysList();

  if (settings.working_days) {
    const activeDays = settings.working_days.split(',').map(d => d.trim());
    document.querySelectorAll('input[name="workDay"]').forEach(cb => {
      cb.checked = activeDays.includes(cb.value);
    });
  }
}

async function handleScheduleSave(e) {
  e.preventDefault();
  saveScheduleBtn.disabled = true;
  saveScheduleBtn.textContent = 'Saving Settings...';

  const selectedDays = Array.from(document.querySelectorAll('input[name="workDay"]:checked')).map(cb => cb.value);

  const newSettings = {
    office_hours_start: settingOfficeStart.value,
    office_hours_end: settingOfficeEnd.value,
    working_days: selectedDays.join(','),
    holidays: settingHolidays.value.trim(),
    max_staff_attempts: parseInt(settingMaxAttempts.value, 10) || 3,
    staff_dial_timeout_seconds: parseInt(settingStaffTimeout.value, 10) || 20,
    max_caller_transfers: parseInt(settingMaxCallerTransfers.value, 10) || 3
  };

  const res = await apiFetch('/admin/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: newSettings })
  });

  saveScheduleBtn.disabled = false;
  saveScheduleBtn.textContent = '💾 Save Schedule & Dialing Settings';

  if (res && res.ok) {
    showToast('Schedule & Dialing Settings saved successfully!', 'success');
  } else {
    showToast('Failed to save settings.', 'error');
  }
}

scheduleSettingsForm?.addEventListener('submit', handleScheduleSave);

// ==========================================
// TAB 5: Caller Callback Requests & Privacy
// ==========================================
async function loadCallbacks() {
  if (!callbacksTableBody) return;
  callbacksTableBody.innerHTML = '<tr><td colspan="8" class="text-center py-4">Loading callback requests...</td></tr>';
  const status = callbackStatusFilter ? callbackStatusFilter.value : 'all';
  const res = await apiFetch(`/admin/api/callbacks?status=${status}`);
  if (!res || !res.ok) return;
  const data = await res.json();
  renderCallbacksTable(data.callbacks || []);
}

function renderCallbacksTable(callbacks) {
  if (!callbacksTableBody) return;
  if (!callbacks.length) {
    callbacksTableBody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No callback requests found matching the filter.</td></tr>';
    return;
  }

  callbacksTableBody.innerHTML = callbacks.map(cb => {
    const isCompleted = cb.status === 'completed';
    const statusBadge = isCompleted 
      ? '<span class="badge badge-success">✅ Completed</span>'
      : '<span class="badge badge-warning">⏳ Pending</span>';

    const reasonLabel = escapeHtml(cb.reason || 'unanswered');
    const timeFormatted = cb.created_at ? new Date(cb.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-';

    return `
      <tr>
        <td style="font-weight: 600; color: #94a3b8;">#${cb.id}</td>
        <td style="white-space: nowrap; font-size: 0.8rem; color: #cbd5e1;">${timeFormatted}</td>
        <td style="font-family: monospace; font-weight: 600;">${escapeHtml(cb.caller_phone_masked || '***')}</td>
        <td><span class="score-tag">${escapeHtml(cb.language || 'en')}</span></td>
        <td style="max-width: 280px; word-break: break-word;"><strong>${escapeHtml(cb.question_text || cb.question || 'Admission Enquiry')}</strong></td>
        <td><span style="background: #1e293b; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">${reasonLabel}</span></td>
        <td>${statusBadge}</td>
        <td>
          <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="openDecryptModal(${cb.id})">
              🔐 Reveal Phone
            </button>
            ${!isCompleted ? `
              <button type="button" class="btn btn-primary btn-sm" onclick="completeCallback(${cb.id})">
                ✓ Mark Done
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.completeCallback = async function(id) {
  const notes = prompt('Add optional note about this completed callback (e.g. "Called parent, explained MCA fee structure"):');
  if (notes === null) return;

  const res = await apiFetch(`/admin/api/callbacks/${id}/complete`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes })
  });

  if (res && res.ok) {
    showToast(`Callback #${id} marked as completed!`, 'success');
    loadCallbacks();
  }
};

window.openDecryptModal = async function(id) {
  if (!decryptModal) return;
  decryptedPhoneValue.textContent = 'Decrypting...';
  decryptModal.style.display = 'flex';

  const res = await apiFetch(`/admin/api/callbacks/${id}/decrypt`, { method: 'POST' });
  if (res && res.ok) {
    const data = await res.json();
    decryptedPhoneValue.textContent = data.phone;
    telDecryptedLink.href = `tel:${data.phone}`;
  } else {
    decryptedPhoneValue.textContent = 'Error decrypting';
    showToast('Failed to decrypt phone number.', 'error');
  }
};

function closeDecryptModal() {
  if (decryptModal) decryptModal.style.display = 'none';
}

function copyDecryptedPhone() {
  const phone = decryptedPhoneValue.textContent.trim();
  if (!phone || phone.includes('Decrypting') || phone.includes('Error')) return;
  navigator.clipboard.writeText(phone);
  showToast(`Copied ${phone} to clipboard!`, 'success');
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
    document.getElementById(targetTab)?.classList.add('active');

    if (targetTab === 'logsTab') loadLogs();
    if (targetTab === 'handoffsTab') loadHandedOffQueries();
    if (targetTab === 'faqsTab') loadFaqs();
    if (targetTab === 'staffTab') {
      loadStaff();
      loadScheduleSettings();
    }
    if (targetTab === 'callbacksTab') loadCallbacks();
  });
});

// Logs Filters
logSearchInput?.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(loadLogs, 250);
});
logStatusFilter?.addEventListener('change', loadLogs);
logChannelFilter?.addEventListener('change', loadLogs);
refreshLogsBtn?.addEventListener('click', () => {
  loadLogs();
  loadStats();
  showToast('Logs refreshed', 'success');
});
exportCsvBtn?.addEventListener('click', handleExportCsv);
refreshHandoffsBtn?.addEventListener('click', loadHandedOffQueries);

// FAQ Search & Modal
faqSearchInput?.addEventListener('input', () => renderFaqsTable(allFaqs));
openAddFaqModalBtn?.addEventListener('click', () => openFaqModal());
closeFaqModalBtn?.addEventListener('click', closeFaqModal);
cancelFaqModalBtn?.addEventListener('click', closeFaqModal);

faqModal?.addEventListener('click', (e) => {
  if (e.target === faqModal) closeFaqModal();
});

// FAQ Form Submission (Create or Edit)
faqModalForm?.addEventListener('submit', async (e) => {
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
    body: JSON.stringify({
      question: q,
      question_hi: modalQuestionHi.value.trim(),
      answer: a,
      answer_en_spoken: modalAnswerEnSpoken.value.trim(),
      answer_hi_spoken: modalAnswerHiSpoken.value.trim(),
      review_status: modalReviewStatus.value || 'draft'
    })
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

// Staff & Callbacks Event Listeners
openAddStaffModalBtn?.addEventListener('click', () => openStaffModal());
closeStaffModalBtn?.addEventListener('click', closeStaffModal);
cancelStaffModalBtn?.addEventListener('click', closeStaffModal);
refreshStaffBtn?.addEventListener('click', loadStaff);
staffModal?.addEventListener('click', (e) => {
  if (e.target === staffModal) closeStaffModal();
});

callbackStatusFilter?.addEventListener('change', loadCallbacks);
refreshCallbacksBtn?.addEventListener('click', loadCallbacks);

closeDecryptModalBtn?.addEventListener('click', closeDecryptModal);
dismissDecryptModalBtn?.addEventListener('click', closeDecryptModal);
copyDecryptedPhoneBtn?.addEventListener('click', copyDecryptedPhone);
decryptModal?.addEventListener('click', (e) => {
  if (e.target === decryptModal) closeDecryptModal();
});

addHolidayBtn?.addEventListener('click', handleAddHoliday);
newHolidayName?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleAddHoliday();
  }
});

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadLogs();
});

