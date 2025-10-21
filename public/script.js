"use strict";
// --- グローバル変数と状態管理 ---
let state = {
    user: null,
    quizzes: [],
    accountOptions: [],
    currentQuiz: {
        questions: [],
        index: 0,
        score: 0,
        questionList: [],
        currentGenre: '',
        currentSubgenre: '',
        currentFilter: 'all',
        studySessionId: null,
    },
    analytics: { allData: null, selectedStudent: null, selectedGenre: null, detailViewSource: null }
};
let weeklyActivityChart = null;
let studentGrowthChart = null;
let dailyAttemptsChart = null;
// --- DOM要素の取得 ---
const views = {
    auth: document.getElementById('auth-view'),
    mainGenre: document.getElementById('main-genre-view'),
    subgenre: document.getElementById('subgenre-view'),
    questionList: document.getElementById('question-list-view'),
    quiz: document.getElementById('quiz-view'),
    result: document.getElementById('result-view'),
    create: document.getElementById('create-view'),
    editList: document.getElementById('edit-list-view'),
    editQuiz: document.getElementById('edit-quiz-view'),
    studentList: document.getElementById('student-list-view'),
    studentGenre: document.getElementById('student-genre-view'),
    studentDetail: document.getElementById('student-detail-view'),
    profile: document.getElementById('profile-view'),
    genreAnalytics: document.getElementById('genre-analytics-view'),
    accountManagement: document.getElementById('account-management-view'),
    analyticsDashboard: document.getElementById('analytics-dashboard-view'),
    achievements: document.getElementById('achievements-view'),
    studentAnalytics: document.getElementById('student-analytics-view'),
    userManagement: document.getElementById('user-management-view'),
};
const appHeader = document.getElementById('app-header');
const feedbackModal = document.getElementById('feedback-modal');
// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await checkSession();
});
// --- 画面表示制御 ---
function showView(viewName) {
    if (!views[viewName]) {
        console.error(`View not found: ${viewName}`);
        return;
    }
    Object.keys(views).forEach(key => {
        const view = views[key];
        if (view) {
            view.classList.toggle('hidden', key !== viewName);
        }
    });
    appHeader.classList.toggle('hidden', viewName === 'auth');
}
// --- API通信 ---
async function apiFetch(endpoint, options = {}, onError = 'auth') {
    try {
        const response = await fetch(endpoint, options);
        if (response.status === 401) {
            document.getElementById('auth-error').textContent = '認証に失敗しました。再度ログインしてください。';
            if (endpoint !== '/api/session') {
                state.user = null;
                showView('auth');
            }
            return null;
        }
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: '不明なエラーが発生しました。' }));
            throw new Error(errorData.error || 'APIエラーが発生しました。');
        }
        if (response.status === 204) {
            return {};
        }
        const text = await response.text();
        return text ? JSON.parse(text) : {};
    }
    catch (error) {
        console.error('API Fetch Error:', error.message);
        if (onError === 'auth') {
            const errorEl = document.getElementById('auth-error');
            if (errorEl)
                errorEl.textContent = error.message;
        }
        else if (onError === 'alert') {
            alert(error.message);
        }
        return null;
    }
}
// --- 初期データ読み込み ---
async function checkSession() {
    const data = await apiFetch('/api/session');
    if (data && data.user) {
        state.user = data.user;
        await Promise.all([loadQuizzes(), loadAccountOptions()]);
        updateHeader();
        showView('mainGenre');
    }
    else {
        showView('auth');
    }
}
async function loadQuizzes() {
    const data = await apiFetch('/api/quizzes');
    if (data) {
        state.quizzes = data;
        renderMainGenreView();
    }
}
async function loadAccountOptions() {
    const data = await apiFetch('/api/accounts');
    if (data) {
        state.accountOptions = data;
        state.accountOptions.sort((a, b) => a.reading.localeCompare(b.reading, 'ja'));
    }
}
function updateHeader() {
    if (state.user) {
        document.getElementById('welcome-message').textContent = `ようこそ、${state.user.username} さん`;
        document.getElementById('show-profile-btn').classList.toggle('hidden', state.user.role !== 'student');
    }
}
// --- イベントハンドラ ---
function setupEventListeners() {
    document.getElementById('header-title').addEventListener('click', () => { if (state.user)
        showView('mainGenre'); });
    document.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('auth-tab-active')); tab.classList.add('auth-tab-active'); const isLogin = tab.dataset.tab === 'login'; document.getElementById('login-form').classList.toggle('hidden', !isLogin); document.getElementById('register-form').classList.toggle('hidden', isLogin); document.getElementById('auth-error').textContent = ''; }));
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const data = await apiFetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        if (data && data.user) {
            state.user = data.user;
            await Promise.all([loadQuizzes(), loadAccountOptions()]);
            updateHeader();
            showView('mainGenre');
        }
    });
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const data = await apiFetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        if (data) {
            alert('登録が完了しました。ログインしてください。');
            document.querySelector('.auth-tab[data-tab="login"]').click();
            document.getElementById('register-form').reset();
        }
    });
    document.getElementById('logout-btn').addEventListener('click', async () => { await apiFetch('/api/logout', { method: 'POST' }); state.user = null; showView('auth'); });
    document.getElementById('show-profile-btn').addEventListener('click', showProfile);
    document.getElementById('back-to-selection-from-profile').addEventListener('click', () => showView('mainGenre'));
    document.getElementById('back-to-main-genre-btn').addEventListener('click', () => showView('mainGenre'));
    document.getElementById('back-to-subgenre-btn').addEventListener('click', () => showSubgenreView(state.currentQuiz.currentGenre));
    document.getElementById('check-answer-btn').addEventListener('click', handleCheckAnswer);
    document.getElementById('retry-btn').addEventListener('click', () => startQuiz('sequential'));
    document.getElementById('back-to-genre-btn-quiz').addEventListener('click', () => showQuestionListView(state.currentQuiz.currentGenre, state.currentQuiz.currentSubgenre));
    document.getElementById('back-to-genre-btn-result').addEventListener('click', () => showQuestionListView(state.currentQuiz.currentGenre, state.currentQuiz.currentSubgenre));
    document.getElementById('show-create-view-btn').addEventListener('click', () => { setupCreateForm(); showView('create'); });
    document.getElementById('show-edit-list-btn').addEventListener('click', showEditListView);
    document.getElementById('back-to-genre-btn-create').addEventListener('click', () => showView('mainGenre'));
    document.getElementById('create-form').addEventListener('submit', handleCreateSubmit);
    document.querySelectorAll('.add-row-btn').forEach(btn => { btn.addEventListener('click', (e) => addEntryRow(e.target.dataset.target)); });
    document.querySelectorAll('input[name="genre-type"]').forEach(radio => { radio.addEventListener('change', (e) => { const isExisting = e.target.value === 'existing'; document.getElementById('new-genre-select').classList.toggle('hidden', !isExisting); document.getElementById('new-genre-input').classList.toggle('hidden', isExisting); }); });
    document.querySelectorAll('input[name="subgenre-type"]').forEach(radio => { radio.addEventListener('change', (e) => { const isExisting = e.target.value === 'existing'; document.getElementById('new-subgenre-select').classList.toggle('hidden', !isExisting); const input = document.getElementById('new-subgenre-input'); input.classList.toggle('hidden', isExisting); input.required = !isExisting; }); });
    document.querySelectorAll('input[name="edit-subgenre-type"]').forEach(radio => { radio.addEventListener('change', (e) => { const isExisting = e.target.value === 'existing'; document.getElementById('edit-subgenre-select').classList.toggle('hidden', !isExisting); const input = document.getElementById('edit-subgenre-input'); input.classList.toggle('hidden', isExisting); input.required = !isExisting; }); });
    document.getElementById('new-genre-select').addEventListener('change', e => { const selectedGenre = e.target.value; populateSubgenreSelect('new-subgenre-select', selectedGenre); });
    document.getElementById('edit-genre-select').addEventListener('change', e => { const selectedGenre = e.target.value; populateSubgenreSelect('edit-subgenre-select', selectedGenre); });
    document.getElementById('back-to-selection-from-edit-list').addEventListener('click', () => showView('mainGenre'));
    document.getElementById('back-to-edit-list-btn').addEventListener('click', showEditListView);
    document.getElementById('edit-form').addEventListener('submit', handleUpdateQuiz);
    document.getElementById('delete-quiz-btn').addEventListener('click', () => { handleDeleteQuiz(document.getElementById('edit-quiz-id').value); });
    document.getElementById('show-analytics-btn').addEventListener('click', showAnalyticsDashboardView);
    document.getElementById('back-to-main-from-dashboard').addEventListener('click', () => showView('mainGenre'));
    document.getElementById('go-to-student-list-btn').addEventListener('click', showStudentList);
    document.getElementById('back-to-selection-from-student-list').addEventListener('click', () => showView('analyticsDashboard'));
    document.getElementById('back-to-student-list-btn').addEventListener('click', showStudentList);
    document.getElementById('back-from-detail-btn').addEventListener('click', () => { if (state.analytics.detailViewSource === 'genreAnalytics') {
        showGenreAnalytics(state.analytics.selectedGenre);
    }
    else {
        showStudentGenres(state.analytics.selectedStudent);
    } });
    document.getElementById('back-to-selection-from-genre-analytics').addEventListener('click', () => showView('mainGenre'));
    document.getElementById('show-accounts-btn').addEventListener('click', showAccountManagementView);
    document.getElementById('add-account-form').addEventListener('submit', handleAccountCreate);
    document.getElementById('back-to-selection-from-accounts').addEventListener('click', () => showView('mainGenre'));
    document.getElementById('start-quiz-sequential-btn').addEventListener('click', () => startQuiz('sequential'));
    document.getElementById('start-quiz-random-btn').addEventListener('click', () => startQuiz('random'));
    document.getElementById('question-filter-select').addEventListener('change', (e) => {
        const select = e.target;
        state.currentQuiz.currentFilter = select.value;
        renderQuestionListView();
    });
    document.getElementById('clear-filter-btn').addEventListener('click', () => {
        const select = document.getElementById('question-filter-select');
        select.value = 'all';
        state.currentQuiz.currentFilter = 'all';
        renderQuestionListView();
    });
    document.getElementById('show-achievements-btn').addEventListener('click', showAchievementsView);
    document.getElementById('back-to-profile-from-achievements').addEventListener('click', () => showView('profile'));
    document.getElementById('show-student-analytics-btn').addEventListener('click', showStudentAnalyticsView);
    document.getElementById('back-to-profile-from-student-analytics').addEventListener('click', () => showView('profile'));
    document.getElementById('show-user-management-btn').addEventListener('click', showUserManagementView);
    document.getElementById('back-to-main-from-usermgmt').addEventListener('click', () => showView('mainGenre'));
    document.getElementById('create-special-user-form').addEventListener('submit', handleCreateSpecialUser);
    document.getElementById('upgrade-to-pro-btn').addEventListener('click', handleUpgradeClick);
}
// --- 画面描画ロジック ---
function renderMainGenreView() {
    const container = document.getElementById('main-genre-container');
    container.innerHTML = '';
    const groupedByGenre = state.quizzes.reduce((acc, quiz) => { (acc[quiz.genre] = acc[quiz.genre] || []).push(quiz); return acc; }, {});
    const genreOrder = ["日商簿記3級", "日商簿記2級", "日商簿記1級", "全経3級", "全経2級", "全経1級"];
    const sortedGenres = Object.keys(groupedByGenre).sort((a, b) => { const indexA = genreOrder.indexOf(a); const indexB = genreOrder.indexOf(b); if (indexA !== -1 && indexB !== -1)
        return indexA - indexB; if (indexA !== -1)
        return -1; if (indexB !== -1)
        return 1; return a.localeCompare(b); });
    sortedGenres.forEach(genre => {
        const card = document.createElement('button');
        card.className = 'genre-card';
        const quizzesInGenre = groupedByGenre[genre];
        const totalAttempts = quizzesInGenre.reduce((sum, q) => sum + (q.total_attempts || 0), 0);
        const correctAttempts = quizzesInGenre.reduce((sum, q) => sum + (q.correct_attempts || 0), 0);
        const genreSuccessRate = totalAttempts > 0 ? (correctAttempts / totalAttempts) * 100 : 0;
        card.innerHTML = `<span class="genre-card-title">${genre}</span><span class="progress-badge" style="background-color: hsl(${genreSuccessRate}, 80%, 85%); color: hsl(${genreSuccessRate}, 80%, 25%);">あなたの進捗 ${genreSuccessRate.toFixed(0)}%</span>`;
        card.addEventListener('click', () => showSubgenreView(genre));
        container.appendChild(card);
    });
    const userRole = state.user?.role;
    document.getElementById('teacher-menu-container').classList.toggle('hidden', userRole !== 'teacher' && userRole !== 'admin');
    document.getElementById('admin-menu-container').classList.toggle('hidden', userRole !== 'admin');
}
function showSubgenreView(genre) {
    state.currentQuiz.currentGenre = genre;
    document.getElementById('subgenre-title').textContent = genre;
    const container = document.getElementById('subgenre-container');
    container.innerHTML = '';
    const groupedBySubgenre = state.quizzes.filter(q => q.genre === genre).reduce((acc, quiz) => { (acc[quiz.subgenre] = acc[quiz.subgenre] || []).push(quiz); return acc; }, {});
    Object.keys(groupedBySubgenre).sort().forEach(subgenre => {
        const btn = document.createElement('button');
        btn.className = 'list-btn';
        btn.innerHTML = `<span>${subgenre}</span><span class="list-btn-arrow">&rsaquo;</span>`;
        btn.addEventListener('click', () => {
            if (state.user?.role === 'teacher' || state.user?.role === 'admin') {
                showGenreAnalytics(genre, subgenre);
            }
            else {
                showQuestionListView(genre, subgenre);
            }
        });
        container.appendChild(btn);
    });
    showView('subgenre');
}
async function showQuestionListView(genre, subgenre) {
    state.currentQuiz.currentGenre = genre;
    state.currentQuiz.currentSubgenre = subgenre;
    document.getElementById('question-list-title').textContent = subgenre;
    const questions = await apiFetch(`/api/subgenres/${encodeURIComponent(genre)}/${encodeURIComponent(subgenre)}/questions`, {}, 'alert');
    if (questions) {
        state.currentQuiz.questionList = questions;
        renderQuestionListView();
        showView('questionList');
    }
}
function getFilteredQuestions() {
    const { questionList, currentFilter } = state.currentQuiz;
    if (currentFilter === 'all') {
        return questionList;
    }
    if (currentFilter === 'favorites') {
        return questionList.filter(q => q.is_favorite);
    }
    if (currentFilter === 'not_answered') {
        return questionList.filter(q => !q.recent_results || q.recent_results.length === 0);
    }
    if (currentFilter === 'incorrect_last') {
        return questionList.filter(q => q.recent_results && q.recent_results.length > 0 && q.recent_results[0] === false);
    }
    return questionList;
}
function renderQuestionListView() {
    const container = document.getElementById('question-list-container');
    container.innerHTML = '';
    const filteredQuestions = getFilteredQuestions();
    if (filteredQuestions.length === 0) {
        container.innerHTML = '<p class="text-slate-500 text-center py-4 col-span-full">表示できる問題がありません。</p>';
        document.getElementById('start-quiz-sequential-btn').disabled = true;
        document.getElementById('start-quiz-random-btn').disabled = true;
        return;
    }
    document.getElementById('start-quiz-sequential-btn').disabled = false;
    document.getElementById('start-quiz-random-btn').disabled = false;
    filteredQuestions.forEach((q) => {
        const originalIndex = state.currentQuiz.questionList.findIndex(item => item.id === q.id);
        const card = document.createElement('div');
        card.className = 'question-card';
        card.setAttribute('title', q.question);
        const historyHtml = (q.recent_results || [])
            .map(isCorrect => `<svg class="w-5 h-5 ${isCorrect ? 'text-green-500' : 'text-red-400'}" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="${isCorrect ? 'M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z' : 'M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z'}" clip-rule="evenodd"></path></svg>`).join('');
        let dateText = '';
        if (q.latest_attempt_timestamp) {
            const date = new Date(q.latest_attempt_timestamp);
            dateText = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
        }
        card.innerHTML = `
            <button data-quiz-id="${q.id}" class="favorite-btn question-card-favorite ${q.is_favorite ? 'is-favorite' : ''}">
                <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
            </button>
            <div class="question-card-number-wrapper">
                <p class="question-card-number">
                    問<span>${originalIndex + 1}</span>
                </p>
            </div>
            <div class="question-card-footer">
                <div class="question-card-history">${historyHtml}</div>
                <span class="question-card-date">${dateText}</span>
            </div>
        `;
        card.querySelector('.favorite-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(q.id); });
        card.addEventListener('click', () => { startQuiz('sequential', q.id); });
        container.appendChild(card);
    });
}
async function toggleFavorite(quizId) {
    const result = await apiFetch(`/api/quizzes/${quizId}/toggle_favorite`, { method: 'POST' });
    if (result) {
        const targetQuiz = state.currentQuiz.questionList.find(q => q.id === quizId);
        if (targetQuiz) {
            targetQuiz.is_favorite = result.is_favorite;
            renderQuestionListView();
        }
        if (result.newlyUnlocked && result.newlyUnlocked.length > 0) {
            result.newlyUnlocked.forEach((ach) => showAchievementToast(ach));
        }
    }
}
async function startQuiz(mode = 'sequential', singleQuizId = null) {
    let questionsToAsk;
    if (singleQuizId) {
        questionsToAsk = state.currentQuiz.questionList.filter(q => q.id === singleQuizId);
    }
    else {
        questionsToAsk = getFilteredQuestions();
    }
    if (questionsToAsk.length === 0) {
        alert('対象の問題がありません。');
        return;
    }
    if (mode === 'random' && !singleQuizId) {
        questionsToAsk = [...questionsToAsk].sort(() => Math.random() - 0.5);
    }
    const { studySessionId } = await apiFetch('/api/study_session/start', { method: 'POST' });
    if (studySessionId) {
        state.currentQuiz.studySessionId = studySessionId;
    }
    state.currentQuiz.questions = questionsToAsk.map(item => state.quizzes.find(q => q.id === item.id));
    state.currentQuiz.index = 0;
    state.currentQuiz.score = 0;
    showView('quiz');
    renderQuiz();
}
async function endStudySession() {
    if (state.currentQuiz.studySessionId) {
        await apiFetch('/api/study_session/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studySessionId: state.currentQuiz.studySessionId })
        });
        state.currentQuiz.studySessionId = null;
    }
}
function renderQuiz() {
    const { questions, index } = state.currentQuiz;
    if (questions.length === 0) {
        showView('questionList');
        alert('問題がありません。');
        return;
    }
    ;
    const quiz = questions[index];
    document.getElementById('quiz-title').textContent = `問題 ${index + 1}`;
    document.getElementById('quiz-question').textContent = quiz.question;
    document.getElementById('quiz-progress').textContent = `${index + 1} / ${questions.length}`;
    loadAnswer('debit-entries-quiz', []);
    loadAnswer('credit-entries-quiz', []);
}
async function handleCheckAnswer() {
    const userAnswer = { debits: getUserEntries('debit-entries-quiz'), credits: getUserEntries('credit-entries-quiz') };
    if (userAnswer.debits.length === 0 && userAnswer.credits.length === 0) {
        alert('解答を入力してください。');
        return;
    }
    const currentQuestion = state.currentQuiz.questions[state.currentQuiz.index];
    const result = await apiFetch('/api/submit_answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            quiz_id: currentQuestion.id,
            user_answer: userAnswer,
            questionsInSession: state.currentQuiz.questions.length,
            score: state.currentQuiz.score,
        })
    });
    if (result) {
        if (result.is_correct) {
            state.currentQuiz.score++;
        }
        if (result.newlyUnlocked && result.newlyUnlocked.length > 0) {
            result.newlyUnlocked.forEach((ach) => showAchievementToast(ach));
        }
        showFeedbackModal(result);
    }
}
function showFeedbackModal(result) {
    const content = document.getElementById('feedback-content');
    const correctEntriesHtml = (entries) => entries.map(e => `<div class="flex justify-between"><span>${e.account}</span><span>${e.amount.toLocaleString()}</span></div>`).join('');
    content.innerHTML = `
        <div class="p-6">
            <div class="text-center mb-4"><h2 class="text-5xl font-bold ${result.is_correct ? 'text-green-500' : 'text-red-500'}">${result.is_correct ? '正解！' : '不正解...'}</h2></div>
            <div class="bg-slate-50 p-4 rounded-lg"><h3 class="font-bold text-lg mb-2 text-slate-700">正しい仕訳</h3><div class="grid grid-cols-2 gap-4 text-sm"><div><h4 class="font-semibold border-b pb-1 mb-1">借方 (Dr.)</h4><div class="space-y-1">${correctEntriesHtml(result.correct_answer.debits)}</div></div><div><h4 class="font-semibold border-b pb-1 mb-1">貸方 (Cr.)</h4><div class="space-y-1">${correctEntriesHtml(result.correct_answer.credits)}</div></div></div></div>
            ${result.explanation ? `<div class="mt-4 bg-yellow-50 p-4 rounded-lg"><h3 class="font-bold text-lg mb-2 text-yellow-800">解説</h3><p class="text-sm text-yellow-700 whitespace-pre-wrap">${result.explanation}</p></div>` : ''}
        </div>
        <div class="bg-slate-100 p-4 rounded-b-xl text-right"><button id="next-question-btn" class="main-btn !w-auto">${state.currentQuiz.index === state.currentQuiz.questions.length - 1 ? '結果を見る' : '次の問題へ'}</button></div>
    `;
    document.getElementById('next-question-btn').addEventListener('click', async () => {
        feedbackModal.classList.add('hidden');
        content.classList.remove('opacity-100', 'translate-y-0');
        content.classList.add('opacity-0', '-translate-y-4');
        if (state.currentQuiz.index < state.currentQuiz.questions.length - 1) {
            state.currentQuiz.index++;
            renderQuiz();
        }
        else {
            await endStudySession();
            showResultsView();
        }
    });
    feedbackModal.classList.remove('hidden');
    setTimeout(() => { content.classList.remove('opacity-0', '-translate-y-4'); content.classList.add('opacity-100', 'translate-y-0'); }, 10);
}
function showResultsView() {
    showView('result');
    document.getElementById('score-text').textContent = `${state.currentQuiz.questions.length}問中 ${state.currentQuiz.score}問 正解！`;
    let message = "";
    const percentage = state.currentQuiz.questions.length > 0 ? (state.currentQuiz.score / state.currentQuiz.questions.length) * 100 : 0;
    if (percentage === 100)
        message = "全問正解です！素晴らしい！🎉";
    else if (percentage >= 70)
        message = "高得点です！この調子で頑張りましょう！";
    else
        message = "もう少しでした！復習して再挑戦してみましょう。";
    document.getElementById('score-message').textContent = message;
}
async function showProfile() { const profileData = await apiFetch('/api/profile'); if (profileData) {
    renderProfile(profileData);
    showView('profile');
} }
function renderProfile(data) {
    document.getElementById('profile-username').textContent = data.username;
    document.getElementById('profile-level').textContent = data.level;
    const xpPercentage = (data.experience / data.xp_for_next_level) * 100;
    document.getElementById('profile-xp-bar').style.width = `${xpPercentage}%`;
    document.getElementById('profile-xp-text').textContent = `XP: ${data.experience} / ${data.xp_for_next_level}`;
    document.getElementById('profile-success-rate').textContent = `${Number(data.success_rate).toFixed(1)}%`;
    document.getElementById('profile-total-attempts').textContent = data.total_attempts;
    const { avatar, rank } = getAvatarAndRank(data.level);
    document.getElementById('profile-avatar').textContent = avatar;
    document.getElementById('profile-rank').textContent = rank;
    const subStatusBadge = document.getElementById('subscription-status-badge');
    if (data.subscription_status === 'active') {
        subStatusBadge.textContent = 'Pro';
        subStatusBadge.className = 'text-sm font-semibold px-2 py-1 rounded-full inline-block bg-green-200 text-green-800';
        document.getElementById('subscription-actions-container').classList.add('hidden');
    }
    else {
        subStatusBadge.textContent = 'Free';
        subStatusBadge.className = 'text-sm font-semibold px-2 py-1 rounded-full inline-block bg-slate-200 text-slate-800';
        document.getElementById('subscription-actions-container').classList.remove('hidden');
    }
}
async function showAnalyticsDashboardView() {
    const data = await apiFetch('/api/analytics/dashboard');
    if (data) {
        renderAnalyticsDashboard(data);
        showView('analyticsDashboard');
    }
}
function renderAnalyticsDashboard(data) {
    const { summary, mistakeRanking, studentGrowth, dailyAttempts } = data;
    const renderComparison = (elem, current, previous, unit = '') => {
        const change = current - previous;
        if (isNaN(change) || !isFinite(change)) {
            elem.textContent = '-';
            elem.className = 'ml-2 text-sm font-semibold text-slate-500';
            return;
        }
        elem.classList.remove('text-green-600', 'text-red-600', 'text-slate-500');
        if (change > 0) {
            elem.textContent = `+${change.toFixed(unit ? 1 : 0)}${unit}`;
            elem.classList.add('text-green-600');
        }
        else if (change < 0) {
            elem.textContent = `${change.toFixed(unit ? 1 : 0)}${unit}`;
            elem.classList.add('text-red-600');
        }
        else {
            elem.textContent = '→';
            elem.classList.add('text-slate-500');
        }
    };
    document.getElementById('summary-total-students').textContent = summary.total_students || '0';
    document.getElementById('summary-wau').textContent = summary.wau_current || '0';
    renderComparison(document.getElementById('summary-wau-comparison'), Number(summary.wau_current || 0), Number(summary.wau_previous || 0));
    document.getElementById('summary-new-students').textContent = summary.new_students_current || '0';
    renderComparison(document.getElementById('summary-new-students-comparison'), Number(summary.new_students_current || 0), Number(summary.new_students_previous || 0));
    document.getElementById('summary-total-attempts').textContent = summary.total_attempts_current || '0';
    renderComparison(document.getElementById('summary-total-attempts-comparison'), Number(summary.total_attempts_current || 0), Number(summary.total_attempts_previous || 0));
    const mistakeContainer = document.getElementById('mistake-ranking-container');
    mistakeContainer.innerHTML = '';
    if (mistakeRanking.length === 0) {
        mistakeContainer.innerHTML = `<p class="text-slate-500">データがありません。</p>`;
    }
    else {
        mistakeRanking.forEach((item) => {
            const mistakeRate = Number(item.mistake_rate || 0).toFixed(1);
            const rankItem = document.createElement('div');
            rankItem.className = 'list-btn !p-3';
            rankItem.innerHTML = `
                <div class="flex-grow min-w-0"><p class="text-xs text-slate-500">${item.genre} > ${item.subgenre}</p><p class="truncate font-semibold">${item.question}</p></div>
                <div class="text-right flex-shrink-0 ml-4"><p class="font-bold text-red-500">${mistakeRate}%</p><p class="text-xs text-slate-500">${item.incorrect_attempts} / ${item.total_attempts}回</p></div>
            `;
            mistakeContainer.appendChild(rankItem);
        });
    }
    const studentGrowthCtx = document.getElementById('student-growth-chart').getContext('2d');
    if (studentGrowthChart)
        studentGrowthChart.destroy();
    studentGrowthChart = new window.Chart(studentGrowthCtx, {
        type: 'line',
        data: {
            labels: studentGrowth.map((d) => new Date(d.day).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })),
            datasets: [{
                    label: '累計学生数',
                    data: studentGrowth.map((d) => d.count),
                    borderColor: 'rgb(59, 130, 246)',
                    tension: 0.1,
                    fill: true,
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                }]
        }
    });
    const dailyAttemptsCtx = document.getElementById('daily-attempts-chart').getContext('2d');
    if (dailyAttemptsChart)
        dailyAttemptsChart.destroy();
    dailyAttemptsChart = new window.Chart(dailyAttemptsCtx, {
        type: 'bar',
        data: {
            labels: dailyAttempts.map((d) => new Date(d.day).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })),
            datasets: [{
                    label: '解答数',
                    data: dailyAttempts.map((d) => d.total_attempts),
                    backgroundColor: 'rgb(34, 197, 94)',
                }]
        },
        options: {
            scales: {
                y: { beginAtZero: true, suggestedMax: 10 }
            }
        }
    });
}
async function showStudentList() { const analyticsData = await apiFetch('/api/analytics/by_student'); if (analyticsData) {
    state.analytics.allData = analyticsData;
    renderStudentList(analyticsData);
    showView('studentList');
} }
function renderStudentList(data) { const container = document.getElementById('student-list-container'); container.innerHTML = ''; const students = Object.keys(data); if (students.length === 0) {
    container.innerHTML = '<p class="text-center text-gray-500 col-span-full">まだ学生の解答データがありません。</p>';
    return;
} students.forEach(username => { const button = document.createElement('button'); button.className = 'list-btn'; button.innerHTML = `<span>${username}</span><span class="list-btn-arrow">&rsaquo;</span>`; button.addEventListener('click', () => showStudentGenres(username)); container.appendChild(button); }); }
function showStudentGenres(username) { state.analytics.selectedStudent = username; renderStudentGenres(username); showView('studentGenre'); }
function renderStudentGenres(username) { document.getElementById('student-genre-title').textContent = `${username}さんの成績`; const container = document.getElementById('student-genre-container'); container.innerHTML = ''; const studentData = state.analytics.allData[username]; const genreOrder = ["日商簿記3級", "日商簿記2級", "日商簿記1級", "全経3級", "全経2級", "全経1級"]; const sortedGenres = Object.keys(studentData.byGenre).sort((a, b) => { const indexA = genreOrder.indexOf(a); const indexB = genreOrder.indexOf(b); if (indexA !== -1 && indexB !== -1)
    return indexA - indexB; if (indexA !== -1)
    return -1; if (indexB !== -1)
    return 1; return a.localeCompare(b); }); sortedGenres.forEach(genre => { const genreSubgenres = studentData.byGenre[genre]; let totalAttempts = 0; let totalCorrects = 0; for (const sub in genreSubgenres) {
    totalAttempts += genreSubgenres[sub].attempts;
    totalCorrects += genreSubgenres[sub].corrects;
} const genreSuccessRate = (totalAttempts > 0) ? (totalCorrects / totalAttempts) * 100 : 0; const button = document.createElement('button'); button.className = 'genre-card'; button.innerHTML = `<span class="genre-card-title">${genre}</span><span class="progress-badge" style="background-color: hsl(${genreSuccessRate}, 80%, 85%); color: hsl(${genreSuccessRate}, 80%, 25%);">正答率 ${genreSuccessRate.toFixed(0)}%</span>`; button.addEventListener('click', () => { state.analytics.detailViewSource = 'studentGenre'; showStudentGenreDetail(genre); }); container.appendChild(button); }); }
async function showStudentGenreDetail(genre, username = state.analytics.selectedStudent) { const attemptData = await apiFetch(`/api/analytics/${username}?genre=${encodeURIComponent(genre)}`); if (attemptData) {
    renderStudentDetail(username, genre, attemptData);
    showView('studentDetail');
} }
function renderStudentDetail(username, genre, attempts) { document.getElementById('student-detail-title').textContent = `${username}さん - ${genre}`; const tbody = document.getElementById('student-detail-tbody'); tbody.innerHTML = ''; if (attempts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-gray-500 py-4">解答履歴がありません。</td></tr>';
    return;
} attempts.forEach(attempt => { const date = new Date(attempt.timestamp); const formattedDate = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; const resultHtml = attempt.is_correct ? '<span class="text-green-600 font-bold">正解</span>' : '<span class="text-red-600 font-bold">不正解</span>'; const row = document.createElement('tr'); row.innerHTML = `<td class="px-4 py-2">${formattedDate}</td><td class="px-4 py-2"><p class="w-64 truncate" title="${attempt.question}">${attempt.question}</p></td><td class="px-4 py-2 text-center">${resultHtml}</td>`; tbody.appendChild(row); }); }
async function showGenreAnalytics(genre, subgenre) { state.analytics.selectedGenre = genre; const analyticsData = await apiFetch(`/api/analytics/genre/${encodeURIComponent(genre)}`); if (analyticsData) {
    renderGenreAnalytics(genre, analyticsData);
    showView('genreAnalytics');
} }
function renderGenreAnalytics(genre, data) { document.getElementById('genre-analytics-title').textContent = `${genre} - 学生の進捗`; const tbody = document.getElementById('genre-analytics-tbody'); tbody.innerHTML = ''; const studentsData = Object.entries(data); if (studentsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-gray-500 py-4">このジャンルを解答した学生はまだいません。</td></tr>';
    return;
} studentsData.forEach(([username, subgenres]) => { Object.entries(subgenres).forEach(([subgenre, stats]) => { const successRate = stats.total_attempts > 0 ? (stats.correct_attempts / stats.total_attempts) * 100 : 0; const row = document.createElement('tr'); row.className = 'cursor-pointer hover:bg-slate-50'; row.innerHTML = `<td class="px-4 py-2">${username}</td><td class="px-4 py-2">${subgenre}</td><td class="px-4 py-2"><span class="progress-badge" style="color: hsl(${successRate}, 80%, 35%);">${successRate.toFixed(0)}%</span></td><td class="px-4 py-2">${stats.correct_attempts} / ${stats.total_attempts}</td>`; row.addEventListener('click', () => { state.analytics.detailViewSource = 'genreAnalytics'; alert(`${username}さんの「${subgenre}」の詳細履歴を表示します。（実装予定）`); }); tbody.appendChild(row); }); }); }
async function handleCreateSubmit(event) { event.preventDefault(); const genreType = document.querySelector('input[name="genre-type"]:checked').value; let genre = genreType === 'existing' ? document.getElementById('new-genre-select').value : document.getElementById('new-genre-input').value.trim(); const subgenreType = document.querySelector('input[name="subgenre-type"]:checked').value; let subgenre = subgenreType === 'existing' ? document.getElementById('new-subgenre-select').value : document.getElementById('new-subgenre-input').value.trim(); const question = document.getElementById('new-question').value.trim(); const explanation = document.getElementById('new-explanation').value.trim(); const newAnswer = { debits: getUserEntries('debit-entries-create'), credits: getUserEntries('credit-entries-create') }; if (!genre || !subgenre || !question || newAnswer.debits.length === 0 || newAnswer.credits.length === 0) {
    alert("ジャンル、小ジャンル、問題文、答えは必須です。");
    return;
} const newQuizData = { genre, subgenre, question, answer: newAnswer, explanation }; const result = await apiFetch('/api/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newQuizData) }); if (result) {
    alert('新しい問題が保存されました！');
    await loadQuizzes();
    showView('mainGenre');
} }
function setupCreateForm() { ['debit-entries-create', 'credit-entries-create'].forEach(id => { document.getElementById(id).innerHTML = ''; addEntryRow(id); }); document.getElementById('create-form').reset(); document.getElementById('new-genre-select').classList.remove('hidden'); document.getElementById('new-genre-input').classList.add('hidden'); populateCreateGenreSelect(); const initialGenre = document.getElementById('new-genre-select').value; populateSubgenreSelect('new-subgenre-select', initialGenre); const subgenreRadio = document.querySelector('input[name="subgenre-type"][value="existing"]'); subgenreRadio.checked = true; subgenreRadio.dispatchEvent(new Event('change')); }
function populateCreateGenreSelect() { const select = document.getElementById('new-genre-select'); select.innerHTML = ''; const defaultOption = document.createElement('option'); defaultOption.value = ""; defaultOption.textContent = "ジャンルを選択してください"; select.appendChild(defaultOption); const genreOrder = ["日商簿記3級", "日商簿記2級", "日商簿記1級", "全経3級", "全経2級", "全経1級"]; const availableGenres = [...new Set(state.quizzes.map(q => q.genre))]; const sortedGenres = genreOrder.filter(g => availableGenres.includes(g)); availableGenres.forEach(genre => { if (!sortedGenres.includes(genre))
    sortedGenres.push(genre); }); sortedGenres.forEach(genre => { const option = document.createElement('option'); option.value = genre; option.textContent = genre; select.appendChild(option); }); }
function populateSubgenreSelect(selectElementId, genre) { const select = document.getElementById(selectElementId); select.innerHTML = ''; const subgenres = [...new Set(state.quizzes.filter(q => q.genre === genre).map(q => q.subgenre))].sort(); if (subgenres.length === 0) {
    const option = document.createElement('option');
    option.textContent = '既存の小ジャンルはありません';
    option.disabled = true;
    select.appendChild(option);
}
else {
    subgenres.forEach(sub => { const option = document.createElement('option'); option.value = sub; option.textContent = sub; select.appendChild(option); });
} }
async function showEditListView() { await loadQuizzes(); renderEditListView(); showView('editList'); }
function renderEditListView() { const container = document.getElementById('edit-list-container'); container.innerHTML = ''; const groupedQuizzes = state.quizzes.reduce((acc, quiz) => { (acc[quiz.genre] = acc[quiz.genre] || []).push(quiz); return acc; }, {}); const genreOrder = ["日商簿記3級", "日商簿記2級", "日商簿記1級", "全経3級", "全経2級", "全経1級"]; const sortedGenres = Object.keys(groupedQuizzes).sort((a, b) => { const indexA = genreOrder.indexOf(a); const indexB = genreOrder.indexOf(b); if (indexA !== -1 && indexB !== -1)
    return indexA - indexB; if (indexA !== -1)
    return -1; if (indexB !== -1)
    return 1; return a.localeCompare(b); }); if (sortedGenres.length === 0) {
    container.innerHTML = '<p class="text-center text-gray-500">編集できる問題がありません。</p>';
    return;
} sortedGenres.forEach(genre => { const genreSection = document.createElement('div'); const title = document.createElement('h3'); title.className = 'edit-list-genre-title'; title.textContent = genre; genreSection.appendChild(title); groupedQuizzes[genre].forEach(quiz => { const item = document.createElement('div'); item.className = 'edit-list-item'; item.innerHTML = `<p><strong>${quiz.subgenre}:</strong> ${quiz.question}</p><div class="edit-list-actions flex space-x-2"><button class="edit-btn" data-id="${quiz.id}">編集</button><button class="delete-btn-list" data-id="${quiz.id}">削除</button></div>`; item.querySelector('.edit-btn').addEventListener('click', (e) => showEditQuizView(e.target.dataset.id)); item.querySelector('.delete-btn-list').addEventListener('click', (e) => handleDeleteQuiz(e.target.dataset.id)); genreSection.appendChild(item); }); container.appendChild(genreSection); }); }
async function showEditQuizView(quizId) { if (!quizId) {
    console.error("編集ボタンに問題IDがありません。");
    alert("問題データの読み込みに失敗しました。");
    return;
} const quizData = await apiFetch(`/api/quizzes/${quizId}`); if (quizData && quizData.id) {
    populateEditForm(quizData);
    showView('editQuiz');
} }
function populateEditForm(quiz) { document.getElementById('edit-quiz-id').value = String(quiz.id); document.getElementById('edit-question').value = quiz.question; document.getElementById('edit-explanation').value = quiz.explanation || ''; const genreSelect = document.getElementById('edit-genre-select'); genreSelect.innerHTML = ''; const availableGenres = [...new Set(state.quizzes.map(q => q.genre))]; availableGenres.forEach(g => { const option = document.createElement('option'); option.value = g; option.textContent = g; genreSelect.appendChild(option); }); genreSelect.value = quiz.genre; populateSubgenreSelect('edit-subgenre-select', quiz.genre); const subgenreSelect = document.getElementById('edit-subgenre-select'); const subgenreExists = [...subgenreSelect.options].some(opt => opt.value === quiz.subgenre); if (subgenreExists) {
    document.querySelector('input[name="edit-subgenre-type"][value="existing"]').checked = true;
    subgenreSelect.value = quiz.subgenre;
}
else {
    document.querySelector('input[name="edit-subgenre-type"][value="new"]').checked = true;
    document.getElementById('edit-subgenre-input').value = quiz.subgenre;
} const activeRadio = document.querySelector('input[name="edit-subgenre-type"]:checked'); activeRadio.dispatchEvent(new Event('change')); loadAnswer('debit-entries-edit', quiz.answer.debits); loadAnswer('credit-entries-edit', quiz.answer.credits); }
async function handleUpdateQuiz(event) { event.preventDefault(); const quizId = document.getElementById('edit-quiz-id').value; const subgenreType = document.querySelector('input[name="edit-subgenre-type"]:checked').value; let subgenre = subgenreType === 'existing' ? document.getElementById('edit-subgenre-select').value : document.getElementById('edit-subgenre-input').value.trim(); const updatedQuiz = { genre: document.getElementById('edit-genre-select').value, subgenre: subgenre, question: document.getElementById('edit-question').value.trim(), explanation: document.getElementById('edit-explanation').value.trim(), answer: { debits: getUserEntries('debit-entries-edit'), credits: getUserEntries('credit-entries-edit') } }; const result = await apiFetch(`/api/quizzes/${quizId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedQuiz) }); if (result) {
    alert('問題が更新されました。');
    await loadQuizzes();
    showEditListView();
} }
async function handleDeleteQuiz(quizId) { if (confirm('この問題を本当に削除しますか？\nこの操作は元に戻せません。')) {
    const result = await apiFetch(`/api/quizzes/${quizId}`, { method: 'DELETE' });
    if (result) {
        alert('問題を削除しました。');
        await loadQuizzes();
        showEditListView();
    }
} }
function getUserEntries(containerId) { const container = document.getElementById(containerId); const entries = []; container.querySelectorAll('.entry-row').forEach(row => { const account = row.querySelector('.account-input').value.trim(); const amountStr = row.querySelector('.amount-input').value.replace(/,/g, ''); const amount = parseInt(amountStr, 10); if (account && !isNaN(amount) && amount > 0) {
    entries.push({ account, amount });
} }); return entries; }
function createAutocompleteInput() { const container = document.createElement('div'); container.className = 'autocomplete-container'; const input = document.createElement('input'); input.type = 'text'; input.className = 'account-input w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 transition'; input.placeholder = '勘定科目'; input.required = true; const suggestions = document.createElement('div'); suggestions.className = 'autocomplete-suggestions hidden'; container.appendChild(input); container.appendChild(suggestions); let activeIndex = -1; const updateHighlight = () => { const items = suggestions.querySelectorAll('.suggestion-item'); items.forEach((item, index) => item.classList.toggle('active', index === activeIndex)); }; const populateSuggestions = (filter = '') => { activeIndex = -1; suggestions.innerHTML = ''; const lowerCaseFilter = filter.toLowerCase(); const filteredOptions = state.accountOptions.filter(opt => opt.name.toLowerCase().includes(lowerCaseFilter) || opt.reading.toLowerCase().startsWith(lowerCaseFilter)); if (filteredOptions.length === 0) {
    suggestions.classList.add('hidden');
    return;
} filteredOptions.forEach(opt => { const item = document.createElement('div'); item.className = 'suggestion-item'; item.textContent = opt.name; item.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = opt.name; suggestions.classList.add('hidden'); }); suggestions.appendChild(item); }); suggestions.classList.remove('hidden'); }; input.addEventListener('focus', () => populateSuggestions(input.value)); input.addEventListener('input', () => populateSuggestions(input.value)); input.addEventListener('blur', () => { setTimeout(() => suggestions.classList.add('hidden'), 150); }); input.addEventListener('keydown', (e) => { const items = suggestions.querySelectorAll('.suggestion-item'); if (suggestions.classList.contains('hidden') || items.length === 0)
    return; if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = (activeIndex + 1) % items.length;
    updateHighlight();
}
else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = (activeIndex - 1 + items.length) % items.length;
    updateHighlight();
}
else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeIndex > -1) {
        input.value = items[activeIndex].textContent;
        suggestions.classList.add('hidden');
    }
}
else if (e.key === 'Escape') {
    suggestions.classList.add('hidden');
} }); return container; }
function createEntryRow() { const row = document.createElement('div'); row.className = 'entry-row'; const accountInputComponent = createAutocompleteInput(); const amountInput = createAmountInput(); const deleteBtn = createDeleteButton(); row.appendChild(accountInputComponent); row.appendChild(amountInput); row.appendChild(deleteBtn); return row; }
function createAmountInput() { const input = document.createElement('input'); input.type = 'text'; input.inputMode = 'numeric'; input.className = 'amount-input w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 transition text-right'; input.placeholder = '金額'; input.required = true; input.addEventListener('input', (e) => { let value = e.target.value.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)); value = value.replace(/[^0-9]/g, ''); if (value) {
    e.target.value = Number(value).toLocaleString();
}
else {
    e.target.value = '';
} }); return input; }
function createDeleteButton() { const button = document.createElement('button'); button.type = 'button'; button.innerHTML = '&#x2715;'; button.className = 'text-red-500 hover:text-red-700 font-bold'; button.onclick = () => button.parentElement.remove(); return button; }
function addEntryRow(containerId) { const container = document.getElementById(containerId); container.appendChild(createEntryRow()); }
function loadAnswer(containerId, entries) { const container = document.getElementById(containerId); container.innerHTML = ''; if (!entries || entries.length === 0) {
    addEntryRow(containerId);
}
else {
    entries.forEach(entry => { const row = createEntryRow(); row.querySelector('.account-input').value = entry.account; row.querySelector('.amount-input').value = entry.amount ? Number(entry.amount).toLocaleString() : ''; container.appendChild(row); });
} }
async function showAccountManagementView() { await loadAccountOptions(); renderAccountManagementView(); showView('accountManagement'); }
function renderAccountManagementView() { const container = document.getElementById('account-list-container'); container.innerHTML = ''; if (state.accountOptions.length === 0) {
    container.innerHTML = `<p class="text-slate-500">登録されている勘定科目がありません。</p>`;
    return;
} state.accountOptions.forEach(acc => { const row = document.createElement('div'); row.className = 'grid grid-cols-[1fr,1fr,auto,auto] gap-4 items-center p-2 rounded-md hover:bg-slate-50'; const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.value = acc.name; nameInput.className = 'account-name-input w-full px-3 py-1 border border-gray-300 rounded-md'; const readingInput = document.createElement('input'); readingInput.type = 'text'; readingInput.value = acc.reading; readingInput.className = 'account-reading-input w-full px-3 py-1 border border-gray-300 rounded-md'; const updateBtn = document.createElement('button'); updateBtn.textContent = '更新'; updateBtn.className = 'edit-btn text-sm'; updateBtn.onclick = () => handleAccountUpdate(acc.id, nameInput.value, readingInput.value); const deleteBtn = document.createElement('button'); deleteBtn.textContent = '削除'; deleteBtn.className = 'delete-btn-list text-sm'; deleteBtn.onclick = () => handleAccountDelete(acc.id, acc.name); row.appendChild(nameInput); row.appendChild(readingInput); row.appendChild(updateBtn); row.appendChild(deleteBtn); container.appendChild(row); }); }
async function handleAccountCreate(event) { event.preventDefault(); const nameInput = document.getElementById('new-account-name'); const readingInput = document.getElementById('new-account-reading'); const name = nameInput.value.trim(); const reading = readingInput.value.trim(); if (!name || !reading) {
    alert('勘定科目名と読み仮名を入力してください。');
    return;
} const result = await apiFetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, reading }) }); if (result) {
    nameInput.value = '';
    readingInput.value = '';
    await loadAccountOptions();
    renderAccountManagementView();
} }
async function handleAccountUpdate(id, name, reading) { if (!name.trim() || !reading.trim()) {
    alert('勘定科目名と読み仮名は必須です。');
    return;
} const result = await apiFetch(`/api/accounts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), reading: reading.trim() }) }); if (result) {
    alert('更新しました。');
    await loadAccountOptions();
    renderAccountManagementView();
} }
async function handleAccountDelete(id, name) { if (confirm(`「${name}」を本当に削除しますか？`)) {
    const result = await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' });
    if (result !== null) {
        alert('削除しました。');
        await loadAccountOptions();
        renderAccountManagementView();
    }
} }
function getAvatarAndRank(level) {
    if (level >= 20)
        return { avatar: '👑', rank: '簿記マスター' };
    if (level >= 15)
        return { avatar: '🐔', rank: 'ベテラン仕訳人' };
    if (level >= 10)
        return { avatar: '🐤', rank: '一人前の仕訳人' };
    if (level >= 5)
        return { avatar: '🐣', rank: 'ひよっこ仕訳人' };
    return { avatar: '🥚', rank: '駆け出し見習い' };
}
async function showAchievementsView() {
    const achievements = await apiFetch('/api/achievements');
    if (achievements) {
        renderAchievementsView(achievements);
        showView('achievements');
    }
}
function renderAchievementsView(achievements) {
    const container = document.getElementById('achievements-container');
    container.innerHTML = '';
    achievements.forEach(ach => {
        const isUnlocked = !!ach.unlocked_at;
        const date = isUnlocked ? new Date(ach.unlocked_at) : null;
        const dateString = date ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}` : '';
        const card = document.createElement('div');
        card.className = `p-4 rounded-lg flex items-center space-x-4 ${isUnlocked ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-400'}`;
        card.innerHTML = `
            <div class="text-4xl">${isUnlocked ? ach.icon : '❓'}</div>
            <div class="flex-grow">
                <p class="font-bold">${ach.name}</p>
                <p class="text-sm ${isUnlocked ? 'text-amber-700' : ''}">${ach.description}</p>
                ${isUnlocked ? `<p class="text-xs font-semibold mt-1">達成日: ${dateString}</p>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}
function showAchievementToast(achievement) {
    const container = document.getElementById('achievement-toast-container');
    const toast = document.createElement('div');
    toast.className = 'bg-white rounded-xl shadow-lg p-4 flex items-center space-x-4 transform transition-all duration-300 translate-x-full opacity-0';
    toast.innerHTML = `
        <div class="text-3xl">${achievement.icon}</div>
        <div>
            <p class="font-bold text-slate-700">アチーブメント達成！</p>
            <p class="text-sm text-slate-500">${achievement.name}</p>
        </div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
    }, 100);
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 5000);
}
async function showUserManagementView() {
    const users = await apiFetch('/api/users');
    if (users) {
        renderUserManagementView(users);
        showView('userManagement');
    }
}
function renderUserManagementView(users) {
    const container = document.getElementById('user-list-container');
    container.innerHTML = '';
    if (users.length === 0) {
        container.innerHTML = `<p class="text-slate-500">ユーザーがいません。</p>`;
        return;
    }
    users.forEach(user => {
        const row = document.createElement('div');
        row.className = 'grid grid-cols-[1fr,1fr,1fr,auto,auto] gap-4 items-center p-2 rounded-md hover:bg-slate-50';
        const roleOptions = ['student', 'teacher', 'admin']
            .map(r => `<option value="${r}" ${user.role === r ? 'selected' : ''}>${r}</option>`)
            .join('');
        row.innerHTML = `
            <p class="font-semibold">${user.username}</p>
            <p>${user.subscription_status}</p>
            <select class="role-select w-full px-3 py-1 border border-gray-300 rounded-md" data-user-id="${user.id}">
                ${roleOptions}
            </select>
            <button class="update-role-btn sub-btn !w-auto px-4 py-1">更新</button>
            <button class="delete-user-btn delete-btn-list !w-auto px-4 py-1" data-user-id="${user.id}" data-username="${user.username}">削除</button>
        `;
        row.querySelector('.update-role-btn').addEventListener('click', () => {
            const select = row.querySelector('.role-select');
            handleRoleUpdate(user.id, select.value);
        });
        row.querySelector('.delete-user-btn').addEventListener('click', (e) => {
            const target = e.target;
            const userId = target.dataset.userId;
            const username = target.dataset.username;
            handleDeleteUser(parseInt(userId, 10), username);
        });
        container.appendChild(row);
    });
}
async function handleRoleUpdate(userId, role) {
    const result = await apiFetch(`/api/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
    });
    if (result) {
        alert('役割を更新しました。');
        showUserManagementView(); // 再描画
    }
}
async function handleCreateSpecialUser(event) {
    event.preventDefault();
    const form = event.target;
    const username = document.getElementById('special-username').value;
    const password = document.getElementById('special-password').value;
    const role = document.getElementById('special-role').value;
    const result = await apiFetch('/api/users/create_special', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
    });
    if (result) {
        alert('特別アカウントを作成しました。');
        form.reset();
        showUserManagementView(); // 再描画
    }
}
async function handleDeleteUser(userId, username) {
    if (confirm(`本当にユーザー「${username}」を削除しますか？この操作は元に戻せません。`)) {
        const result = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
        if (result) {
            alert('ユーザーを削除しました。');
            showUserManagementView(); // 再描画
        }
    }
}
async function showStudentAnalyticsView() {
    const data = await apiFetch('/api/analytics/student');
    if (data) {
        renderStudentAnalyticsView(data);
        showView('studentAnalytics');
    }
}
function renderStudentAnalyticsView(data) {
    const { summary, weeklyActivity, previousDaySummary } = data;
    document.getElementById('student-summary-today-time').textContent = `${Math.round(summary.total_minutes || 0)}分`;
    document.getElementById('student-summary-today-attempts').textContent = `${summary.total_attempts || 0}問`;
    document.getElementById('student-summary-today-accuracy').textContent = `${Number(summary.accuracy || 0).toFixed(1)}%`;
    const comparisonEl = document.getElementById('student-analytics-comparison');
    const diff = Math.round(summary.total_minutes || 0) - Math.round(previousDaySummary.total_minutes_prev || 0);
    if (diff > 0) {
        comparisonEl.textContent = `昨日より ${diff}分 長く学習しました！素晴らしい！`;
        comparisonEl.className = 'text-center text-green-600 font-semibold mb-8';
    }
    else if (diff < 0) {
        comparisonEl.textContent = `昨日より ${-diff}分 学習時間が短くなっています。`;
        comparisonEl.className = 'text-center text-red-600 font-semibold mb-8';
    }
    else {
        comparisonEl.textContent = `昨日と同じくらいの学習時間です。継続が大事！`;
        comparisonEl.className = 'text-center text-slate-500 mb-8';
    }
    const ctx = document.getElementById('weekly-activity-chart').getContext('2d');
    if (weeklyActivityChart) {
        weeklyActivityChart.destroy();
    }
    weeklyActivityChart = new window.Chart(ctx, {
        type: 'line',
        data: {
            labels: weeklyActivity.map((d) => new Date(d.day).toLocaleDateString('ja-JP', { weekday: 'short' })),
            datasets: [{
                    label: '学習時間 (分)',
                    data: weeklyActivity.map((d) => Math.round(d.minutes)),
                    borderColor: 'rgb(59, 130, 246)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3,
                }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return `${context.dataset.label}: ${context.parsed.y} 分`;
                        }
                    }
                }
            }
        }
    });
}
async function handleUpgradeClick() {
    const config = await apiFetch('/api/stripe/config', {}, 'alert');
    if (!config || !config.publishableKey) {
        alert('Stripeの設定を読み込めませんでした。');
        return;
    }
    const stripe = window.Stripe(config.publishableKey);
    const session = await apiFetch('/api/subscription/create-checkout-session', { method: 'POST' }, 'alert');
    if (session && session.sessionId) {
        stripe.redirectToCheckout({ sessionId: session.sessionId });
    }
}
