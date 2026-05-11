const state = {
  view: "overview",
  activeCategoryId: null,
  categories: [],
  lastSearchJobs: [],
  autoSyncedCategories: new Set(),
  progressTimer: null,
};

const PROVIDERS = [
  "Work.ua",
  "DOU",
  "Djinni",
  "Remotive",
  "Arbeitnow",
  "RemoteOK",
  "Himalayas",
  "RemoteJobs",
];

const el = {
  nav: document.querySelector("#main-nav"),
  categoryTabs: document.querySelector("#category-tabs"),
  pageTitle: document.querySelector("#page-title"),
  query: document.querySelector("#query-input"),
  city: document.querySelector("#city-input"),
  salary: document.querySelector("#salary-input"),
  remote: document.querySelector("#remote-input"),
  searchList: document.querySelector("#search-list"),
  favoritesList: document.querySelector("#favorites-list"),
  categoryList: document.querySelector("#category-list"),
  categoryTitle: document.querySelector("#category-title"),
  categorySummary: document.querySelector("#category-summary"),
  feedStatus: document.querySelector("#feed-status"),
  toast: document.querySelector("#toast"),
  metricTotal: document.querySelector("#metric-total"),
  metricSaved: document.querySelector("#metric-saved"),
  metricToday: document.querySelector("#metric-today"),
  sourceChart: document.querySelector("#source-chart"),
  salaryChart: document.querySelector("#salary-chart"),
  categoryChart: document.querySelector("#category-chart"),
  searchButton: document.querySelector("#search-button"),
  saveCategoryButton: document.querySelector("#save-category-button"),
  progress: document.querySelector("#search-progress"),
  progressTitle: document.querySelector("#progress-title"),
  progressPercent: document.querySelector("#progress-percent"),
  progressBar: document.querySelector("#progress-bar"),
  providerGrid: document.querySelector("#provider-grid"),
};

function api(path, options = {}) {
  return fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  }).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed: ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  });
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("visible");
  window.setTimeout(() => el.toast.classList.remove("visible"), 3200);
}

function icons() {
  if (window.lucide) window.lucide.createIcons();
}

function switchView(view, categoryId = null) {
  state.view = view;
  state.activeCategoryId = categoryId;
  document.querySelectorAll(".view").forEach((node) => node.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.remove("active"));
  document.querySelectorAll(".category-tab").forEach((node) => node.classList.remove("active"));

  const target = view === "category" ? "category" : view;
  document.querySelector(`#view-${target}`).classList.add("active");
  const navButton = document.querySelector(`[data-view="${view}"]`);
  if (navButton) navButton.classList.add("active");

  if (view === "category") {
    document.querySelector(`[data-category-id="${categoryId}"]`)?.classList.add("active");
    const category = state.categories.find((item) => item.id === categoryId);
    el.pageTitle.textContent = category?.name || "Pinned search";
    el.categoryList.innerHTML = "";
    loadCategoryJobs(categoryId);
  } else {
    el.pageTitle.textContent = view === "favorites" ? "Favorites" : view === "search" ? "Search vacancies" : "Overview";
  }
}

function sourceLabel(source) {
  return {
    workua: "Work.ua",
    dou: "DOU",
    djinni: "Djinni",
    remotive: "Remotive",
    arbeitnow: "Arbeitnow",
    remoteok: "RemoteOK",
    himalayas: "Himalayas",
    remotejobs: "RemoteJobs",
  }[source] || source;
}

function formatDate(value) {
  if (!value) return "unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function money(value) {
  if (value === null || value === undefined) return "";
  return Number(value).toLocaleString("en");
}

function jobCard(job) {
  const saved = job.is_saved ? "saved" : "";
  const salary = job.salary_raw || (job.salary_min ? `${money(job.salary_min)} - ${money(job.salary_max)}` : "Salary undisclosed");
  const description = job.description || "No public description was indexed yet.";
  return `
    <article class="vacancy-card">
      <div class="vacancy-card-header">
        <div class="vacancy-title">
          <span class="source-badge">${sourceLabel(job.source)}</span>
          <h3>${job.title}</h3>
        </div>
        <span class="salary">${salary}</span>
      </div>
      <p class="company">${job.company_name || "Company undisclosed"}</p>
      <div class="vacancy-meta">
        <span>${job.city || "UA / Remote"}</span>
        <span>${job.remote ? "Remote" : "Office / Hybrid"}</span>
        <span>${formatDate(job.posted_at)}</span>
      </div>
      <p class="description">${description}</p>
      <div class="card-footer">
        <a href="${job.source_url}" target="_blank" rel="noreferrer">Open vacancy</a>
        <button class="save-button ${saved}" data-job-id="${job.internal_id}">
          <span data-lucide="${job.is_saved ? "star" : "star-plus"}"></span>
          ${job.is_saved ? "Saved" : "Save"}
        </button>
      </div>
    </article>
  `;
}

function renderJobs(container, jobs, emptyText) {
  if (!jobs.length) {
    container.innerHTML = `<div class="empty-state"><div><span>${emptyText}</span><h2>Run a search or sync a category</h2></div></div>`;
    icons();
    return;
  }
  container.innerHTML = jobs.map(jobCard).join("");
  icons();
}

function renderLoadingCards(container) {
  container.innerHTML = `
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
  `;
}

function setSearchBusy(isBusy) {
  el.searchButton.disabled = isBusy;
  el.saveCategoryButton.disabled = isBusy;
  el.query.disabled = isBusy;
  el.city.disabled = isBusy;
  el.salary.disabled = isBusy;
  el.remote.disabled = isBusy;
}

function startSearchProgress(query) {
  window.clearInterval(state.progressTimer);
  el.progress.classList.remove("hidden");
  el.providerGrid.innerHTML = PROVIDERS.map(
    (provider) => `<div class="provider-chip"><span>${provider}</span><i class="provider-dot"></i></div>`,
  ).join("");

  const steps = [
    { percent: 8, title: `Preparing free-text search for "${query}"`, active: 0 },
    { percent: 20, title: "Querying Ukrainian providers", active: 2 },
    { percent: 38, title: "Querying global remote APIs", active: 5 },
    { percent: 56, title: "Expanding aliases and typo-tolerant matches", active: 7 },
    { percent: 72, title: "Normalizing salaries, companies and source URLs", active: 8 },
    { percent: 86, title: "Deduplicating and saving results", active: 8 },
  ];
  let index = 0;
  applyProgressStep(steps[index]);
  state.progressTimer = window.setInterval(() => {
    index = Math.min(index + 1, steps.length - 1);
    applyProgressStep(steps[index]);
  }, 1800);
}

function applyProgressStep(step) {
  el.progressTitle.textContent = step.title;
  el.progressPercent.textContent = `${step.percent}%`;
  el.progressBar.style.width = `${step.percent}%`;
  [...el.providerGrid.children].forEach((chip, index) => {
    chip.classList.toggle("done", index < step.active);
    chip.classList.toggle("active", index === step.active);
  });
}

function finishSearchProgress(count) {
  window.clearInterval(state.progressTimer);
  el.progressTitle.textContent = `Rendered ${count} matched vacancies`;
  el.progressPercent.textContent = "100%";
  el.progressBar.style.width = "100%";
  [...el.providerGrid.children].forEach((chip) => {
    chip.classList.add("done");
    chip.classList.remove("active");
  });
  window.setTimeout(() => el.progress.classList.add("hidden"), 1400);
}

function failSearchProgress(message) {
  window.clearInterval(state.progressTimer);
  el.progressTitle.textContent = message;
  el.progressPercent.textContent = "!";
  el.progressBar.style.width = "100%";
}

function searchParams() {
  const params = new URLSearchParams();
  params.set("q", el.query.value.trim() || "full stack");
  if (el.city.value.trim()) params.set("city", el.city.value.trim());
  if (el.salary.value.trim()) params.set("salary_min", el.salary.value.trim());
  if (el.remote.checked) params.set("remote", "true");
  return params;
}

async function runSearch() {
  const query = el.query.value.trim() || "full stack";
  el.feedStatus.textContent = "searching 8 sources";
  setSearchBusy(true);
  startSearchProgress(query);
  renderLoadingCards(el.searchList);

  try {
    const params = searchParams();
    params.set("page_limit", "1");
    await api(`/api/v1/scrape/all?${params.toString()}`, { method: "POST" });
    const jobs = await api(`/api/v1/vacancies/search?${searchParams().toString()}`);
    state.lastSearchJobs = jobs;
    renderJobs(el.searchList, jobs, "No matches found");
    el.feedStatus.textContent = `${jobs.length} matched`;
    finishSearchProgress(jobs.length);
    await refreshOverview();
  } catch (error) {
    failSearchProgress(error.message);
    renderJobs(el.searchList, [], "Search failed");
    el.feedStatus.textContent = "failed";
    showToast(error.message);
  } finally {
    setSearchBusy(false);
  }
}

async function saveCategory() {
  const query = el.query.value.trim() || "full stack";
  const name = window.prompt("Category name", query);
  if (!name) return;
  const payload = {
    name,
    query,
    city: el.city.value.trim() || null,
    remote: el.remote.checked ? true : null,
    salary_min: el.salary.value ? Number(el.salary.value) : null,
    sources: ["workua", "dou", "djinni", "remotive", "arbeitnow", "remoteok", "himalayas", "remotejobs"],
  };
  const category = await api("/api/v1/categories", { method: "POST", body: JSON.stringify(payload) });
  await loadCategories();
  switchView("category", category.id);
  showToast(`Pinned "${category.name}"`);
  await syncActiveCategory();
}

async function loadCategories() {
  state.categories = await api("/api/v1/categories");
  el.categoryTabs.innerHTML = state.categories
    .map(
      (category) => `
        <button class="category-tab" data-category-id="${category.id}">
          <span>${category.name}</span>
          <small>${category.total} total · ${category.new_today} new</small>
        </button>
      `,
    )
    .join("");
}

async function loadFavorites() {
  const saved = await api("/api/v1/saved");
  renderJobs(
    el.favoritesList,
    saved.map((item) => item.job),
    "No saved vacancies yet",
  );
}

async function loadCategoryJobs(categoryId) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return;
  el.categoryTitle.textContent = category.name;
  el.categorySummary.innerHTML = `
    <span>Query: <strong>${category.query}</strong></span>
    <span>Total: <strong>${category.total}</strong></span>
    <span>New today: <strong>${category.new_today}</strong></span>
  `;
  renderJobs(el.categoryList, [], "Loading this category");
  if (category.total === 0 && !state.autoSyncedCategories.has(categoryId)) {
    state.autoSyncedCategories.add(categoryId);
    const result = await api(`/api/v1/categories/${categoryId}/sync?page_limit=1`, { method: "POST" });
    showToast(`First sync: parsed ${result.parsed}, linked ${result.linked}`);
    await loadCategories();
    return loadCategoryJobs(categoryId);
  }
  const jobs = await api(`/api/v1/categories/${categoryId}/vacancies`);
  renderJobs(el.categoryList, jobs, "No vacancies in this category yet");
}

async function syncActiveCategory() {
  if (!state.activeCategoryId) return;
  showToast("Category sync started");
  const result = await api(`/api/v1/categories/${state.activeCategoryId}/sync?page_limit=1`, { method: "POST" });
  showToast(`Parsed ${result.parsed}, linked ${result.linked} new`);
  await loadCategories();
  await loadCategoryJobs(state.activeCategoryId);
  await refreshOverview();
}

async function deleteActiveCategory() {
  if (!state.activeCategoryId) return;
  const category = state.categories.find((item) => item.id === state.activeCategoryId);
  if (!window.confirm(`Delete category "${category?.name || "this category"}"?`)) return;
  await api(`/api/v1/categories/${state.activeCategoryId}`, { method: "DELETE" });
  await loadCategories();
  switchView("overview");
  await refreshOverview();
}

async function toggleSave(jobId) {
  const button = document.querySelector(`[data-job-id="${jobId}"]`);
  const isSaved = button?.classList.contains("saved");
  if (isSaved) {
    await api(`/api/v1/saved/${jobId}`, { method: "DELETE" });
    showToast("Removed from favorites");
  } else {
    await api(`/api/v1/saved/${jobId}`, { method: "POST", body: JSON.stringify({ notes: null }) });
    showToast("Saved to favorites");
  }
  if (state.view === "favorites") await loadFavorites();
  if (state.view === "category") await loadCategoryJobs(state.activeCategoryId);
  if (state.view === "search") {
    const jobs = await api(`/api/v1/vacancies/search?${searchParams().toString()}`);
    renderJobs(el.searchList, jobs, "No matches found");
  }
  await refreshOverview();
}

function renderBars(container, rows, valueKey = "count") {
  const max = Math.max(1, ...rows.map((row) => row[valueKey]));
  container.innerHTML = rows
    .map((row) => {
      const label = row.source ? sourceLabel(row.source) : row.label || row.name;
      const value = row[valueKey];
      return `<div class="bar-row"><span>${label}</span><div><i style="width:${(value / max) * 100}%"></i></div><strong>${value}</strong></div>`;
    })
    .join("");
}

async function refreshOverview() {
  const stats = await api("/api/v1/stats");
  const today = stats.by_source.reduce((sum, item) => sum + item.today, 0);
  el.metricTotal.textContent = stats.total;
  el.metricSaved.textContent = stats.saved_total;
  el.metricToday.textContent = today;
  renderBars(el.sourceChart, stats.by_source, "total");
  renderBars(el.salaryChart, stats.salary_ranges, "count");
  renderBars(el.categoryChart, stats.categories, "new_today");
}

el.searchButton.addEventListener("click", runSearch);
document.querySelector("#save-category-button").addEventListener("click", saveCategory);
document.querySelector("#sync-category-button").addEventListener("click", syncActiveCategory);
document.querySelector("#delete-category-button").addEventListener("click", deleteActiveCategory);
document.querySelector("#refresh-button").addEventListener("click", async () => {
  await refreshOverview();
  if (state.view === "favorites") await loadFavorites();
  if (state.view === "category") await loadCategoryJobs(state.activeCategoryId);
});

document.body.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) {
    switchView(nav.dataset.view);
    if (nav.dataset.view === "favorites") loadFavorites();
    if (nav.dataset.view === "overview") refreshOverview();
    return;
  }
  const categoryTab = event.target.closest("[data-category-id]");
  if (categoryTab) {
    switchView("category", categoryTab.dataset.categoryId);
    return;
  }
  const saveButton = event.target.closest("[data-job-id]");
  if (saveButton) {
    toggleSave(saveButton.dataset.jobId);
  }
});

async function boot() {
  icons();
  await loadCategories();
  await refreshOverview();
  switchView("overview");
}

boot().catch((error) => showToast(error.message));
