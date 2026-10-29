(() => {
  const tabs = [
    ['dashboard', 'Dashboard'], ['challenges', 'Challenges'], ['users', 'Users'],
    ['analytics', 'Analytics'], ['achievements', 'Achievements'],
  ];
  const state = {
    context: null, listening: false, challengePage: 1, userPage: 1,
    challengeQuery: '', challengeLanguage: '', challengeDifficulty: '', challengeStatus: 'all',
    userQuery: '', userSort: 'createdAt', userDirection: 'desc', editor: null, userDetail: null,
  };
  const e = (value) => state.context.esc(value);
  const api = (...args) => state.context.api(...args);
  const root = () => state.context.root;
  const notify = (message) => state.context.notify(message);
  const titleFor = (tab) => (tabs.find(([key]) => key === tab) || tabs[0])[1];
  const dateText = (value) => value ? new Date(value).toLocaleString() : '\u2014';

  function shell(tab, content) {
    const links = tabs.map(([key, label]) => `<button class="admin-side-link ${tab === key ? 'active' : ''}" data-action="admin-tab" data-tab="${key}"><span>${label}</span><span aria-hidden="true">\u203a</span></button>`).join('');
    root().innerHTML = state.context.header() + `<main class="admin-layout"><aside class="admin-sidebar"><div class="admin-side-title">Admin workspace</div><nav aria-label="Administrator navigation">${links}<button class="admin-side-link admin-logout" data-action="logout"><span>Logout</span><span aria-hidden="true">\u2197</span></button></nav><div class="admin-side-note">Signed in as<br><strong>${e(state.context.me?.name || 'Administrator')}</strong></div></aside><section class="admin-main"><div class="admin-page-head"><div><div class="eyebrow">BugHunt control room</div><h1>${titleFor(tab)}</h1></div><div class="admin-role-pill"><span class="admin-avatar">${e((state.context.me?.name || 'A').slice(0, 1).toUpperCase())}</span><span>${e(state.context.me?.name || 'Administrator')}<small>Administrator</small></span></div></div><div class="admin-content">${content}</div></section></main>`;
  }

  function loading(tab, message = 'Loading live database data\u2026') {
    shell(tab, `<div class="card admin-loading"><span class="loading-dot"></span><p>${e(message)}</p></div>`);
  }

  function errorState(tab, error) {
    shell(tab, `<div class="card empty"><h2>Could not load ${e(titleFor(tab).toLowerCase())}</h2><p>${e(error.message || 'Please try again.')}</p><button class="btn" data-action="admin-reload">Try again</button></div>`);
  }

  function statCard(label, value, detail, icon) {
    return `<article class="admin-stat"><div class="admin-stat-top"><span>${e(label)}</span><span class="admin-stat-icon">${icon}</span></div><strong>${Number(value || 0).toLocaleString()}</strong><small>${e(detail)}</small></article>`;
  }

  function chartBars(rows, label, valueKey, maxRows = 12) {
    if (!rows.length) return '<div class="admin-empty">No stored activity for this period yet.</div>';
    const max = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)));
    return `<div class="admin-bars" aria-label="${e(label)}">${rows.slice(-maxRows).map((row) => {
      const value = Number(row[valueKey] || 0);
      const caption = row.date ? row.date.slice(5) : row.label || row.language || row.range || row.title || '';
      return `<div class="admin-bar-col" title="${e(caption)}: ${value}"><div class="admin-bar-track"><i style="height:${Math.max(value ? 8 : 0, Math.round(value / max * 100))}%"></i></div><strong>${value}</strong><small>${e(caption)}</small></div>`;
    }).join('')}</div>`;
  }

  function recentActivity(items) {
    if (!items.length) return '<div class="admin-empty">No challenge submissions have been recorded yet.</div>';
    return `<div class="table-scroll"><table class="table admin-table"><thead><tr><th>Learner</th><th>Challenge</th><th>Language</th><th>Result</th><th>Submitted</th></tr></thead><tbody>${items.map((item) => `<tr><td>${e(item.user?.name || 'Account unavailable')}</td><td>${e(item.challenge?.title || 'Challenge unavailable')}</td><td>${e(item.challenge?.language || '\u2014')}</td><td><span class="admin-result ${item.correct ? 'is-correct' : 'is-incorrect'}">${item.correct ? 'Correct' : 'Incorrect'}</span></td><td>${e(dateText(item.createdAt))}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function dashboard() {
    loading('dashboard');
    try {
      const [stats, analytics] = await Promise.all([api('/admin/stats'), api('/admin/analytics?days=30')]);
      shell('dashboard', `<div class="admin-stats-grid">${statCard('Registered users', stats.users, 'Accounts in the database', '\u25c9')}${statCard('Challenges', stats.challenges, 'All stored challenges', '\u2318')}${statCard('Submissions', stats.attempts, 'Recorded challenge attempts', '\u2197')}${statCard('Successful submissions', stats.successfulSubmissions, `${stats.attempts ? Math.round(stats.successfulSubmissions / stats.attempts * 100) : 0}% of submissions`, '\u2713')}</div><div class="admin-grid two-col"><article class="card admin-panel"><div class="admin-panel-head"><div><h2>User growth</h2><p class="muted">New registrations per day \u00b7 last 30 days</p></div><span class="tag blue">Live</span></div>${chartBars(analytics.userGrowth, 'User growth', 'count')}</article><article class="card admin-panel"><div class="admin-panel-head"><div><h2>Challenge attempts</h2><p class="muted">Attempts per day \u00b7 last 30 days</p></div><span class="tag">Live</span></div>${chartBars(analytics.attemptTrend, 'Challenge attempts', 'attempts')}</article></div><div class="admin-grid two-col"><article class="card admin-panel"><div class="admin-panel-head"><div><h2>Language activity</h2><p class="muted">Submissions by programming language</p></div></div>${chartBars(analytics.byLanguage.map((row) => ({ ...row, label: row.language })), 'Language activity', 'attempts', 3)}</article><article class="card admin-panel"><div class="admin-panel-head"><div><h2>Recent registrations</h2><button class="quiet" data-action="admin-tab" data-tab="users">View all</button></div></div>${analytics.recentUsers.length ? `<div class="admin-recent-list">${analytics.recentUsers.map((user) => `<div><span class="admin-avatar">${e((user.name || '?').slice(0, 1).toUpperCase())}</span><span><strong>${e(user.name)}</strong><small>${e(user.email)}</small></span><time>${e(dateText(user.createdAt))}</time></div>`).join('')}</div>` : '<div class="admin-empty">No accounts have registered yet.</div>'}</article></div><article class="card admin-panel"><div class="admin-panel-head"><div><h2>Recent challenge submissions</h2><p class="muted">Latest activity across the platform</p></div><button class="quiet" data-action="admin-tab" data-tab="analytics">Open analytics</button></div>${recentActivity(analytics.recentActivity)}</article>`);
    } catch (error) { errorState('dashboard', error); }
  }

  function challengeForm(challenge = {}) {
    const editing = !!challenge.id;
    return `<article class="card admin-editor"><div class="admin-panel-head"><div><h2>${editing ? 'Edit challenge' : 'Create challenge'}</h2><p class="muted">The answer key remains available only through protected administrator routes.</p></div><button type="button" class="quiet" data-action="challenge-editor-close">Close</button></div><form id="adminChallengeForm" data-id="${e(challenge.id || '')}"><div class="admin-form-grid"><label>Title<input class="field" name="title" maxlength="120" required value="${e(challenge.title || '')}"></label><label>Topic<input class="field" name="topic" maxlength="120" required value="${e(challenge.topic || '')}"></label><label>Language<select name="language">${['Python', 'Java', 'C++'].map((x) => `<option ${challenge.language === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Difficulty<select name="difficulty">${['Beginner', 'Intermediate', 'Advanced'].map((x) => `<option ${challenge.difficulty === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>XP reward<input class="field" type="number" name="xpReward" min="1" max="1000" required value="${Number(challenge.xpReward || 10)}"></label>${editing ? `<label>Status<select name="active"><option value="true" ${challenge.active ? 'selected' : ''}>Active</option><option value="false" ${challenge.active === false ? 'selected' : ''}>Inactive</option></select></label>` : ''}</div><label>Description<textarea class="field" name="description" maxlength="2000" required>${e(challenge.description || '')}</textarea></label><label>Broken code<textarea class="field admin-code-input" name="buggyCode" maxlength="12000" required>${e(challenge.buggyCode || '')}</textarea></label><div class="admin-form-grid">${[0, 1, 2, 3].map((i) => `<label>Option ${i + 1}<textarea class="field admin-code-input" name="option${i}" maxlength="1000" required>${e(challenge.options?.[i] || '')}</textarea></label>`).join('')}</div><div class="admin-form-grid"><label>Correct option<select name="correctIndex">${[0, 1, 2, 3].map((i) => `<option value="${i}" ${challenge.correctIndex === i ? 'selected' : ''}>Option ${i + 1}</option>`).join('')}</select></label><label>Corrected code<input class="field" name="correctedCode" maxlength="12000" required value="${e(challenge.correctedCode || '')}"></label></div><label>Hints <small>(one per line)</small><textarea class="field" name="hints" required>${e((challenge.hints || ['']).join('\n'))}</textarea></label><label>Explanation<textarea class="field" name="explanation" maxlength="2000" required>${e(challenge.explanation || '')}</textarea></label><div class="row"><button class="btn" type="submit">${editing ? 'Save changes' : 'Create challenge'}</button><button class="btn secondary" type="button" data-action="challenge-editor-close">Cancel</button></div></form></article>`;
  }

  async function challenges() {
    loading('challenges');
    try {
      const params = new URLSearchParams({ page: String(state.challengePage), limit: '10', status: state.challengeStatus });
      if (state.challengeQuery) params.set('q', state.challengeQuery);
      if (state.challengeLanguage) params.set('language', state.challengeLanguage);
      if (state.challengeDifficulty) params.set('difficulty', state.challengeDifficulty);
      const data = await api(`/admin/challenges?${params}`);
      shell('challenges', `${state.editor ? challengeForm(state.editor === true ? {} : state.editor) : ''}<div class="card admin-panel"><div class="admin-panel-head"><div><h2>Challenge library</h2><p class="muted">Search, filter, edit or deactivate stored challenges.</p></div><button class="btn" data-action="challenge-new">+ New challenge</button></div><form id="adminChallengeFilters" class="admin-filters"><input class="field" name="q" placeholder="Search title or topic" value="${e(state.challengeQuery)}"><select name="language"><option value="">All languages</option>${['Python', 'Java', 'C++'].map((x) => `<option ${state.challengeLanguage === x ? 'selected' : ''}>${x}</option>`).join('')}</select><select name="difficulty"><option value="">All difficulties</option>${['Beginner', 'Intermediate', 'Advanced'].map((x) => `<option ${state.challengeDifficulty === x ? 'selected' : ''}>${x}</option>`).join('')}</select><select name="status"><option value="all" ${state.challengeStatus === 'all' ? 'selected' : ''}>All statuses</option><option value="active" ${state.challengeStatus === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${state.challengeStatus === 'inactive' ? 'selected' : ''}>Inactive</option></select><button class="btn secondary">Apply</button></form>${data.items.length ? `<div class="table-scroll"><table class="table admin-table"><thead><tr><th>Challenge</th><th>Language</th><th>Difficulty</th><th>XP</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.items.map((item) => `<tr><td><strong>${e(item.title)}</strong><small>${e(item.topic)}</small></td><td>${e(item.language)}</td><td>${e(item.difficulty)}</td><td>${Number(item.xpReward || 0)}</td><td><span class="admin-result ${item.active ? 'is-correct' : 'is-incorrect'}">${item.active ? 'Active' : 'Inactive'}</span></td><td><div class="row"><button class="btn secondary small" data-action="challenge-edit" data-id="${e(item.id)}">Edit</button>${item.active ? `<button class="btn secondary small" data-action="challenge-delete" data-id="${e(item.id)}">Deactivate</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty">No challenges match these filters.</div>'}<div class="admin-pagination"><span>${data.total} challenge${data.total === 1 ? '' : 's'} \u00b7 page ${data.page} of ${Math.max(1, data.pages)}</span><div class="row"><button class="btn secondary small" data-action="challenge-page" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn secondary small" data-action="challenge-page" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Next</button></div></div></div>`);
    } catch (error) { errorState('challenges', error); }
  }

  async function editChallenge(id) {
    try {
      const { challenge } = await api(`/admin/challenges/${encodeURIComponent(id)}`);
      state.editor = challenge;
      await challenges();
    } catch (error) { notify(error.message); }
  }

  async function deactivateChallenge(id) {
    if (!window.confirm('Deactivate this challenge? Existing submissions and learner progress will be preserved.')) return;
    try {
      await api(`/admin/challenges/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Challenge deactivated. Existing attempts were preserved.');
      await challenges();
    } catch (error) { notify(error.message); }
  }

  async function submitChallenge(form) {
    const fields = Object.fromEntries(new FormData(form));
    const id = form.dataset.id;
    const body = {
      title: fields.title, topic: fields.topic, language: fields.language, difficulty: fields.difficulty,
      xpReward: Number(fields.xpReward), description: fields.description, buggyCode: fields.buggyCode,
      options: [0, 1, 2, 3].map((index) => fields[`option${index}`]),
      correctIndex: Number(fields.correctIndex), correctedCode: fields.correctedCode,
      hints: fields.hints.split(/\r?\n/).map((hint) => hint.trim()).filter(Boolean), explanation: fields.explanation,
    };
    if (fields.active !== undefined) body.active = fields.active === 'true';
    try {
      await api(`/admin/challenges${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      state.editor = null;
      notify(id ? 'Challenge updated.' : 'Challenge created.');
      await challenges();
    } catch (error) { notify(error.message); }
  }

  function userDetailsMarkup(data) {
    const user = data.user;
    return `<article class="card admin-detail-card"><div class="admin-panel-head"><div><h2>${e(user.name)}</h2><p class="muted">${e(user.email)}</p></div><button class="quiet" data-action="user-detail-close">Close</button></div><div class="admin-detail-stats"><span><small>Role</small><strong>${e(user.role)}</strong></span><span><small>XP</small><strong>${Number(user.xp || 0)}</strong></span><span><small>Streak</small><strong>${Number(user.streak || 0)} days</strong></span><span><small>Solved submissions</small><strong>${Number(data.successfulSubmissions || 0)}</strong></span><span><small>Registered</small><strong>${e(dateText(user.createdAt))}</strong></span><span><small>Last activity</small><strong>${e(dateText(user.lastActivityDate))}</strong></span></div><h3>Recent submissions</h3>${data.attempts.length ? `<div class="table-scroll"><table class="table admin-table"><thead><tr><th>Challenge</th><th>Language</th><th>Result</th><th>XP</th><th>Date</th></tr></thead><tbody>${data.attempts.map((attempt) => `<tr><td>${e(attempt.challenge?.title || 'Challenge unavailable')}</td><td>${e(attempt.challenge?.language || '\u2014')}</td><td>${attempt.correct ? 'Correct' : 'Incorrect'}</td><td>${Number(attempt.xpAwarded || 0)}</td><td>${e(dateText(attempt.createdAt))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty">This user has no submissions yet.</div>'}</article>`;
  }

  async function users() {
    loading('users');
    try {
      const params = new URLSearchParams({ page: String(state.userPage), limit: '15', sort: state.userSort, direction: state.userDirection });
      if (state.userQuery) params.set('q', state.userQuery);
      const data = await api(`/admin/users?${params}`);
      let detail = '';
      if (state.userDetail) {
        try { detail = userDetailsMarkup(await api(`/admin/users/${encodeURIComponent(state.userDetail)}`)); }
        catch (error) { state.userDetail = null; detail = `<div class="admin-inline-error">${e(error.message)}</div>`; }
      }
      shell('users', `${detail}<article class="card admin-panel"><div class="admin-panel-head"><div><h2>Registered users</h2><p class="muted">Account and learning progress details. Passwords and tokens are never returned.</p></div></div><form id="adminUserFilters" class="admin-filters"><input class="field" name="q" placeholder="Search name or email" value="${e(state.userQuery)}"><select name="sort"><option value="createdAt" ${state.userSort === 'createdAt' ? 'selected' : ''}>Newest registration</option><option value="name" ${state.userSort === 'name' ? 'selected' : ''}>Name</option><option value="email" ${state.userSort === 'email' ? 'selected' : ''}>Email</option><option value="xp" ${state.userSort === 'xp' ? 'selected' : ''}>XP</option><option value="streak" ${state.userSort === 'streak' ? 'selected' : ''}>Streak</option></select><select name="direction"><option value="desc" ${state.userDirection === 'desc' ? 'selected' : ''}>Descending</option><option value="asc" ${state.userDirection === 'asc' ? 'selected' : ''}>Ascending</option></select><button class="btn secondary">Apply</button></form>${data.items.length ? `<div class="table-scroll"><table class="table admin-table"><thead><tr><th>User</th><th>Role</th><th>XP</th><th>Streak</th><th>Registered</th><th></th></tr></thead><tbody>${data.items.map((user) => `<tr><td><strong>${e(user.name)}</strong><small>${e(user.email)}</small></td><td>${e(user.role)}</td><td>${Number(user.xp || 0)}</td><td>${Number(user.streak || 0)} days</td><td>${e(dateText(user.createdAt))}</td><td><button class="btn secondary small" data-action="user-detail" data-id="${e(user.id)}">View details</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty">No users match this search.</div>'}<div class="admin-pagination"><span>${data.total} account${data.total === 1 ? '' : 's'} \u00b7 page ${data.page} of ${Math.max(1, data.pages)}</span><div class="row"><button class="btn secondary small" data-action="user-page" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn secondary small" data-action="user-page" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Next</button></div></div><p class="admin-readonly-note">Account deletion and suspension are unavailable because the current User model has no status or safe lifecycle support. Role changes are not exposed in this dashboard.</p></article>`);
    } catch (error) { errorState('users', error); }
  }

  function analyticsCharts(data, days) {
    return `<div class="admin-analytics-head"><div><div class="eyebrow">Stored activity</div><h2>Analytics overview</h2></div><select id="adminAnalyticsDays" aria-label="Analytics date range"><option value="7" ${days === 7 ? 'selected' : ''}>Last 7 days</option><option value="30" ${days === 30 ? 'selected' : ''}>Last 30 days</option><option value="90" ${days === 90 ? 'selected' : ''}>Last 90 days</option></select></div><div class="admin-grid two-col"><article class="card admin-panel"><h3>New registrations by day</h3>${chartBars(data.userGrowth, 'New registrations', 'count', 18)}</article><article class="card admin-panel"><h3>Challenge attempts by day</h3>${chartBars(data.attemptTrend, 'Challenge attempts', 'attempts', 18)}</article><article class="card admin-panel"><h3>Correct versus incorrect</h3><p class="muted">Actual submitted answers during the selected period.</p>${chartBars(data.attemptTrend.flatMap((row) => [{ label: `${row.date.slice(5)} correct`, attempts: row.correct }, { label: `${row.date.slice(5)} incorrect`, attempts: row.attempts - row.correct }]), 'Submission accuracy', 'attempts', 12)}</article><article class="card admin-panel"><h3>Activity by language</h3>${chartBars(data.byLanguage.map((row) => ({ ...row, label: row.language })), 'Activity by language', 'attempts', 3)}</article></div><article class="card admin-panel"><h3>Most attempted challenges and completion</h3>${data.challengePerformance.length ? `<div class="table-scroll"><table class="table admin-table"><thead><tr><th>Challenge</th><th>Language</th><th>Learners</th><th>Attempts</th><th>Completion</th></tr></thead><tbody>${data.challengePerformance.map((row) => `<tr><td>${e(row.title || 'Challenge unavailable')}</td><td>${e(row.language || '\u2014')}</td><td>${Number(row.solvers || 0)} / ${Number(row.learners || 0)}</td><td>${Number(row.attempts || 0)}</td><td><div class="admin-rate"><i style="width:${Math.min(100, Math.max(0, Number(row.completionRate || 0)))}%"></i></div><small>${Number(row.completionRate || 0)}%</small></td></tr>`).join('')}</tbody></table></div>` : '<div class="admin-empty">No challenge attempts are available yet.</div>'}</article><article class="card admin-panel"><h3>XP distribution</h3>${chartBars(data.xpDistribution.map((row) => ({ ...row, label: `${row.range} XP` })), 'XP distribution', 'users', 4)}</article>`;
  }

  async function analytics() {
    loading('analytics');
    try {
      const days = Number(sessionStorage.getItem('bughunt_admin_analytics_days')) || 30;
      const [stats, data] = await Promise.all([api('/admin/stats'), api(`/admin/analytics?days=${days}`)]);
      shell('analytics', `<div class="admin-stats-grid">${statCard('Registered users', stats.users, 'All accounts', '\u25c9')}${statCard('Challenges', stats.challenges, 'All stored challenges', '\u2318')}${statCard('Attempts', stats.attempts, 'All recorded submissions', '\u2197')}${statCard('Correct', stats.successfulSubmissions, `${stats.attempts ? Math.round(stats.successfulSubmissions / stats.attempts * 100) : 0}% overall success rate`, '\u2713')}</div>${analyticsCharts(data, days)}`);
    } catch (error) { errorState('analytics', error); }
  }

  function achievementForm(item = {}) {
    const editing = !!item.id;
    return `<article class="card admin-editor"><div class="admin-panel-head"><div><h2>${editing ? 'Edit achievement' : 'Create achievement'}</h2><p class="muted">This schema stores badge metadata; reward criteria are defined in application logic.</p></div><button type="button" class="quiet" data-action="achievement-editor-close">Close</button></div><form id="adminAchievementForm" data-id="${e(item.id || '')}"><label>Key <small>(lowercase, numbers and hyphens)</small><input class="field" name="key" maxlength="80" required value="${e(item.key || '')}" ${editing ? 'readonly' : ''}></label><label>Name<input class="field" name="name" maxlength="80" required value="${e(item.name || '')}"></label><label>Description<textarea class="field" name="description" maxlength="240" required>${e(item.description || '')}</textarea></label><label>Icon<select name="icon">${['bug', 'star', 'target', 'python', 'java', 'cpp'].map((icon) => `<option value="${icon}" ${item.icon === icon ? 'selected' : ''}>${icon}</option>`).join('')}</select></label><div class="row"><button class="btn">${editing ? 'Save changes' : 'Create achievement'}</button><button type="button" class="btn secondary" data-action="achievement-editor-close">Cancel</button></div></form></article>`;
  }

  async function achievements() {
    loading('achievements');
    try {
      const { items } = await api('/admin/achievements');
      shell('achievements', `${state.editor ? achievementForm(state.editor === true ? {} : state.editor) : ''}<article class="card admin-panel"><div class="admin-panel-head"><div><h2>Achievement catalog</h2><p class="muted">Edit badge content while preserving stored user awards.</p></div><button class="btn" data-action="achievement-new">+ New achievement</button></div>${items.length ? `<div class="admin-achievement-grid">${items.map((item) => `<article class="admin-achievement"><span class="tag blue">${e(item.icon)}</span><h3>${e(item.name)}</h3><p class="muted">${e(item.description)}</p><small>Key: ${e(item.key)}</small><div class="row"><button class="btn secondary small" data-action="achievement-edit" data-id="${e(item.id)}">Edit</button><button class="btn secondary small" data-action="achievement-delete" data-id="${e(item.id)}">Delete</button></div></article>`).join('')}</div>` : '<div class="admin-empty">No achievements have been defined yet.</div>'}<p class="admin-readonly-note">Achievement definitions already referenced by user awards cannot be deleted. This dashboard does not change XP or award criteria.</p></article>`);
    } catch (error) { errorState('achievements', error); }
  }

  async function editAchievement(id) {
    try {
      const { items } = await api('/admin/achievements');
      const item = items.find((row) => row.id === id);
      if (!item) throw Error('Achievement not found.');
      state.editor = item;
      await achievements();
    } catch (error) { notify(error.message); }
  }

  async function submitAchievement(form) {
    const fields = Object.fromEntries(new FormData(form));
    const id = form.dataset.id;
    try {
      await api(`/admin/achievements${id ? `/${encodeURIComponent(id)}` : ''}`, {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify({ key: fields.key, name: fields.name, description: fields.description, icon: fields.icon }),
      });
      state.editor = null;
      notify(id ? 'Achievement updated.' : 'Achievement created.');
      await achievements();
    } catch (error) { notify(error.message); }
  }

  async function deleteAchievement(id) {
    if (!window.confirm('Delete this achievement definition? It will be blocked if any user has already earned it.')) return;
    try {
      await api(`/admin/achievements/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Achievement deleted.');
      await achievements();
    } catch (error) { notify(error.message); }
  }

  async function load(tab) {
    if (tab === 'challenges') return challenges();
    if (tab === 'users') return users();
    if (tab === 'analytics') return analytics();
    if (tab === 'achievements') return achievements();
    return dashboard();
  }

  function onClick(event) {
    const control = event.target.closest('[data-action]');
    if (!control) return;
    switch (control.dataset.action) {
      case 'admin-tab':
        state.editor = null;
        state.context.go(`admin/${control.dataset.tab}`);
        break;
      case 'admin-reload': load(state.context.tab); break;
      case 'challenge-new': state.editor = true; challenges(); break;
      case 'challenge-editor-close': state.editor = null; challenges(); break;
      case 'challenge-edit': editChallenge(control.dataset.id); break;
      case 'challenge-delete': deactivateChallenge(control.dataset.id); break;
      case 'challenge-page': state.challengePage = Number(control.dataset.page); challenges(); break;
      case 'user-page': state.userPage = Number(control.dataset.page); users(); break;
      case 'user-detail': state.userDetail = control.dataset.id; users(); break;
      case 'user-detail-close': state.userDetail = null; users(); break;
      case 'achievement-new': state.editor = true; achievements(); break;
      case 'achievement-editor-close': state.editor = null; achievements(); break;
      case 'achievement-edit': editAchievement(control.dataset.id); break;
      case 'achievement-delete': deleteAchievement(control.dataset.id); break;
      default: break;
    }
  }

  function onSubmit(event) {
    const form = event.target;
    if (form.id === 'adminChallengeForm') { event.preventDefault(); submitChallenge(form); return; }
    if (form.id === 'adminAchievementForm') { event.preventDefault(); submitAchievement(form); return; }
    if (form.id === 'adminChallengeFilters') {
      event.preventDefault(); const fields = Object.fromEntries(new FormData(form));
      state.challengeQuery = fields.q.trim(); state.challengeLanguage = fields.language; state.challengeDifficulty = fields.difficulty; state.challengeStatus = fields.status; state.challengePage = 1; challenges(); return;
    }
    if (form.id === 'adminUserFilters') {
      event.preventDefault(); const fields = Object.fromEntries(new FormData(form));
      state.userQuery = fields.q.trim(); state.userSort = fields.sort; state.userDirection = fields.direction; state.userPage = 1; users();
    }
  }

  function render(tab, context) {
    state.context = { ...context, tab: tabs.some(([key]) => key === tab) ? tab : 'dashboard' };
    if (!state.listening) {
      root().addEventListener('click', onClick);
      root().addEventListener('submit', onSubmit);
      root().addEventListener('change', (event) => {
        if (event.target.id === 'adminAnalyticsDays') {
          sessionStorage.setItem('bughunt_admin_analytics_days', event.target.value);
          analytics();
        }
      });
      state.listening = true;
    }
    return load(state.context.tab);
  }

  window.BugHuntAdmin = { render };
})();
