const state = {
  view: "overview",
  activeCategoryId: null,
  categories: [],
  lastSearchJobs: [],
  autoSyncedCategories: new Set(),
  progressTimer: null,
  statsCache: null,
  statsCacheAt: 0,
  marketMapRendered: false,
};

const PROVIDERS = [
  { id: "workua", label: "Work.ua" },
  { id: "dou", label: "DOU" },
  { id: "djinni", label: "Djinni" },
  { id: "remotive", label: "Remotive" },
  { id: "arbeitnow", label: "Arbeitnow" },
  { id: "remoteok", label: "RemoteOK" },
  { id: "himalayas", label: "Himalayas" },
  { id: "remotejobs", label: "RemoteJobs" },
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
  metricSources: document.querySelector("#metric-sources"),
  sourceChart: document.querySelector("#source-chart"),
  salaryChart: document.querySelector("#salary-chart"),
  categoryChart: document.querySelector("#category-chart"),
  marketMapBoard: document.querySelector("#market-map-board"),
  marketMapTotal: document.querySelector("#market-map-total"),
  marketSourceList: document.querySelector("#market-source-list"),
  searchButton: document.querySelector("#search-button"),
  saveCategoryButton: document.querySelector("#save-category-button"),
  expandIndexButton: document.querySelector("#expand-index-button"),
  progress: document.querySelector("#search-progress"),
  progressTitle: document.querySelector("#progress-title"),
  progressPercent: document.querySelector("#progress-percent"),
  progressBar: document.querySelector("#progress-bar"),
  providerGrid: document.querySelector("#provider-grid"),
  sourceFilterGrid: document.querySelector("#source-filter-grid"),
  selectAllSourcesButton: document.querySelector("#select-all-sources-button"),
  clearSourcesButton: document.querySelector("#clear-sources-button"),
};

const INDEX_SEED_QUERIES = [
  "python",
  "backend",
  "frontend",
  "react",
  "node",
  "full stack",
  "qa",
  "devops",
  "data",
  "ai",
  "unity",
  "product manager",
];

const MARKET_SEGMENTS = [
  { id: "backend", label: "Backend", terms: ["backend", "python", "node", "java", "api", "server", "golang", "django"] },
  { id: "frontend", label: "Frontend", terms: ["frontend", "react", "vue", "angular", "javascript", "typescript", "next"] },
  { id: "fullstack", label: "Full stack", terms: ["full stack", "fullstack", "full-stack"] },
  { id: "ai", label: "AI / Data", terms: ["ai", "ml", "machine learning", "data", "llm", "openai", "analytics"] },
  { id: "devops", label: "DevOps", terms: ["devops", "cloud", "sre", "aws", "azure", "kubernetes", "platform"] },
  { id: "qa", label: "QA", terms: ["qa", "quality", "test", "automation tester"] },
  { id: "game", label: "Game / Unity", terms: ["unity", "unreal", "game", "gamedev"] },
  { id: "product", label: "Product", terms: ["product manager", "project manager", "scrum", "owner"] },
];

function getUserId() {
  const storageKey = "getjobhub_user_id";
  let userId = window.localStorage.getItem(storageKey);
  if (!userId) {
    userId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, userId);
  }
  return userId;
}

function api(path, options = {}) {
  const method = options.method || "GET";
  const url = path.startsWith("http") ? path : `${window.location.origin}${path}`;
  console.log(`[API Request] ${method} ${url}`, options.body ? JSON.parse(options.body) : "");
  
  return fetch(path, {
    headers: {
      "Content-Type": "application/json",
      "X-GetJobHub-User-Id": getUserId(),
      ...(options.headers || {}),
    },
    ...options,
  }).then(async (response) => {
    console.log(`[API Response] ${method} ${url} - Status: ${response.status}`);
    if (!response.ok) {
      const errorText = `API Error: ${response.status} ${response.statusText} on ${method} ${path}`;
      console.error(errorText);
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || errorText);
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

function selectedSources() {
  const checked = [...document.querySelectorAll("[data-source-input]:checked")].map((input) => input.value);
  return checked.length ? checked : PROVIDERS.map((provider) => provider.id);
}

function selectedProviderLabels() {
  const selected = new Set(selectedSources());
  return PROVIDERS.filter((provider) => selected.has(provider.id)).map((provider) => provider.label);
}

function updateSourceCountLabel() {
  const count = selectedSources().length;
  const suffix = count === 1 ? "source" : "sources";
  el.searchButton.innerHTML = `<span data-lucide="scan-search"></span>Search ${count} ${suffix}`;
  if (el.feedStatus.textContent === "ready" || el.feedStatus.textContent.includes("source")) {
    el.feedStatus.textContent = `${count} ${suffix} selected`;
  }
  icons();
}

function renderSourceFilters() {
  el.sourceFilterGrid.innerHTML = PROVIDERS.map(
    (provider) => `
      <label class="source-choice">
        <input type="checkbox" data-source-input value="${provider.id}" checked />
        <span>${provider.label}</span>
      </label>
    `,
  ).join("");
  updateSourceCountLabel();
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

function classifyJob(job) {
  const haystack = `${job.title || ""} ${job.company_name || ""} ${job.description || ""}`.toLowerCase();
  return MARKET_SEGMENTS.find((segment) => segment.terms.some((term) => haystack.includes(term)))?.id || "other";
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
          <span data-lucide="${job.is_saved ? "star" : "star"}"></span>
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
  const providers = selectedProviderLabels();
  el.providerGrid.innerHTML = providers.map(
    (provider) => `<div class="provider-chip"><span>${provider}</span><i class="provider-dot"></i></div>`,
  ).join("");
  const providerCount = providers.length;

  const steps = [
    { percent: 8, title: `Preparing free-text search for "${query}"`, active: 0 },
    { percent: 22, title: "Querying selected providers", active: Math.min(2, providerCount) },
    { percent: 48, title: "Scoring relevance across titles and tags", active: Math.ceil(providerCount / 2) },
    { percent: 72, title: "Normalizing salaries, companies and source URLs", active: providerCount },
    { percent: 86, title: "Deduplicating and saving results", active: providerCount },
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
  selectedSources().forEach((source) => params.append("source", source));
  return params;
}

async function runSearch() {
  const query = el.query.value.trim() || "full stack";
  const sourceCount = selectedSources().length;
  el.feedStatus.textContent = `searching ${sourceCount} source${sourceCount === 1 ? "" : "s"}`;
  setSearchBusy(true);
  startSearchProgress(query);
  renderLoadingCards(el.searchList);

  try {
    const params = searchParams();
    params.set("page_limit", "3");
    await api(`/api/v1/scrape/all?${params.toString()}`, { method: "POST" });
    const jobs = await api(`/api/v1/vacancies/search?${searchParams().toString()}`);
    state.lastSearchJobs = jobs;
    renderJobs(el.searchList, jobs, "No matches found");
    el.feedStatus.textContent = `${jobs.length} matched`;
    finishSearchProgress(jobs.length);
    await refreshOverviewFresh();
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
    sources: selectedSources(),
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
  await refreshOverviewFresh();
}

async function deleteActiveCategory() {
  if (!state.activeCategoryId) return;
  const category = state.categories.find((item) => item.id === state.activeCategoryId);
  if (!window.confirm(`Delete category "${category?.name || "this category"}"?`)) return;
  await api(`/api/v1/categories/${state.activeCategoryId}`, { method: "DELETE" });
  await loadCategories();
  switchView("overview");
  await refreshOverviewFresh();
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
    state.lastSearchJobs = state.lastSearchJobs.map((job) =>
      job.internal_id === jobId ? { ...job, is_saved: !isSaved } : job,
    );
    renderJobs(el.searchList, state.lastSearchJobs, "No matches found");
  }
  await refreshOverviewFresh();
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
  const stats = await loadStats();
  const today = stats.by_source.reduce((sum, item) => sum + item.today, 0);
  el.metricTotal.textContent = stats.total;
  el.metricSaved.textContent = stats.saved_total;
  el.metricToday.textContent = today;
  el.metricSources.textContent = stats.by_source.length;
  renderBars(el.sourceChart, stats.by_source, "total");
  renderBars(el.salaryChart, stats.salary_ranges, "count");
  renderBars(el.categoryChart, stats.categories, "new_today");
}

async function loadStats(force = false) {
  const cacheAge = Date.now() - state.statsCacheAt;
  if (!force && state.statsCache && cacheAge < 30000) return state.statsCache;

  state.statsCache = await api("/api/v1/stats");
  state.statsCacheAt = Date.now();
  return state.statsCache;
}

async function refreshOverviewFresh() {
  await loadStats(true);
  state.marketMapRendered = false;
  await refreshOverview();
}

async function renderMarketMap() {
  const stats = await loadStats();
  const jobs = await api("/api/v1/vacancies/search?limit=200");
  const counts = Object.fromEntries(MARKET_SEGMENTS.map((segment) => [segment.id, 0]));
  counts.other = 0;

  jobs.forEach((job) => {
    counts[classifyJob(job)] = (counts[classifyJob(job)] || 0) + 1;
  });

  const max = Math.max(1, ...Object.values(counts));
  const cards = [
    ...MARKET_SEGMENTS,
    { id: "other", label: "Other", terms: ["mixed roles"] },
  ];

  el.marketMapTotal.textContent = stats.total;
  el.marketMapBoard.innerHTML = cards
    .map((segment) => {
      const count = counts[segment.id] || 0;
      const size = 0.72 + (count / max) * 1.28;
      return `
        <article class="market-node" style="--node-scale:${size}">
          <span>${segment.label}</span>
          <strong>${count}</strong>
          <small>${segment.terms.slice(0, 4).join(" · ")}</small>
        </article>
      `;
    })
    .join("");

  const total = Math.max(1, stats.total);
  el.marketSourceList.innerHTML = stats.by_source
    .map(
      (row) => `
        <div class="market-source-row">
          <span>${sourceLabel(row.source)}</span>
          <i style="width:${(row.total / total) * 100}%"></i>
          <strong>${row.total}</strong>
        </div>
      `,
    )
    .join("");
  state.marketMapRendered = true;
}

async function expandIndex() {
  if (!el.expandIndexButton) return;
  el.expandIndexButton.disabled = true;
  el.feedStatus.textContent = "expanding index";

  try {
    const sources = selectedSources();
    let parsed = 0;
    let created = 0;

    for (const query of INDEX_SEED_QUERIES) {
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("page_limit", "2");
      sources.forEach((source) => params.append("source", source));
      const result = await api(`/api/v1/scrape/all?${params.toString()}`, { method: "POST" });
      parsed += result.parsed || 0;
      created += result.created || 0;
      el.feedStatus.textContent = `${created} new from ${parsed} parsed`;
    }

    await refreshOverviewFresh();
    showToast(`Index expanded: ${created} new vacancies`);
  } catch (error) {
    showToast(error.message);
    el.feedStatus.textContent = "index failed";
  } finally {
    el.expandIndexButton.disabled = false;
  }
}

el.searchButton.addEventListener("click", runSearch);
el.expandIndexButton?.addEventListener("click", expandIndex);
el.selectAllSourcesButton.addEventListener("click", () => {
  document.querySelectorAll("[data-source-input]").forEach((input) => {
    input.checked = true;
  });
  updateSourceCountLabel();
});
el.clearSourcesButton.addEventListener("click", () => {
  document.querySelectorAll("[data-source-input]").forEach((input) => {
    input.checked = false;
  });
  updateSourceCountLabel();
});
el.sourceFilterGrid.addEventListener("change", (event) => {
  if (event.target.matches("[data-source-input]")) updateSourceCountLabel();
});
document.querySelector("#save-category-button").addEventListener("click", saveCategory);
document.querySelector("#sync-category-button").addEventListener("click", syncActiveCategory);
document.querySelector("#delete-category-button").addEventListener("click", deleteActiveCategory);

document.body.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) {
    switchView(nav.dataset.view);
    if (nav.dataset.view === "favorites") loadFavorites();
    if (nav.dataset.view === "overview") refreshOverview();
    if (nav.dataset.view === "market" && !state.marketMapRendered) renderMarketMap();
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
  renderSourceFilters();
  try {
    const health = await api("/api/v1/ping");
    console.log("API Health Check:", health);
  } catch (e) {
    console.error("API Health Check Failed:", e.message);
  }
  await loadCategories();
  await refreshOverviewFresh();
  switchView("overview");
}

boot().catch((error) => showToast(error.message));
