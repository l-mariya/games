(() => {
  'use strict';

  const cfg = window.GAME_CONFIG;
  const app = document.getElementById('app');

  /* ---------- config normalisation (старые конфиги тоже работают) ---------- */

  const ui = {
    questionOf: (n, total) => `Вопрос ${n} из ${total}`,
    bonusLabel: 'Бонусный вопрос',
    rightTitles: ['В точку!'],
    wrongTitles: ['Мимо'],
    next: 'Дальше',
    toBonus: 'К бонусу ★',
    toResult: 'Узнать результат',
    counting: 'Считаем баллы…',
    restart: 'Пройти ещё раз',
    share: 'Поделиться',
    noAchievements: '',
    lockedTitle: 'Ещё не открыто',
    lockedHint: '',
    allUnlocked: '',
    secretTitle: '???',
    secretText: '',
    envelope: 'Письмо',
    envelopeHint: 'Нажми, чтобы открыть',
    copy: 'Копировать',
    copied: 'Скопировано ✓',
    nativeShare: 'Отправить',
    back: 'Назад',
    ...cfg.ui,
  };
  const words = {
    points: cfg.ui.points || ['балл', 'балла', 'баллов'],
    questions: ['вопрос', 'вопроса', 'вопросов'],
    achievements: ['ачивка', 'ачивки', 'ачивок'],
    ...(cfg.ui.words || {}),
  };

  const normalizeQuestion = (q, i) => ({
    ...q,
    id: q.id || `q${i + 1}`,
    options: q.options.map((o) => (typeof o === 'string' ? { text: o } : o)),
  });

  const questions = cfg.questions.map(normalizeQuestion);
  const bonus = cfg.bonus ? { ...cfg.bonus, question: normalizeQuestion(cfg.bonus.question, 99) } : null;
  const achievements = cfg.achievements || [];
  const results = [...cfg.results].sort((a, b) => b.minScore - a.minScore);
  const total = questions.length;
  const maxScore = total * cfg.pointsPerCorrect;
  const LETTERS = ['А', 'Б', 'В', 'Г', 'Д'];

  const state = {};

  function resetState() {
    Object.assign(state, {
      queue: questions.map((q) => ({ q, isBonus: false })),
      pos: 0,
      mainAnswered: 0,
      score: 0,
      correctMain: 0,
      streak: 0,
      bestStreak: 0,
      picks: {},
      tags: {},
      egg: false,
      answered: false,
      letterOpen: false,
      tier: null,
      earned: [],
    });
  }

  /* ---------- helpers ---------- */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const paragraphs = (list) => list.map((p) => `<p>${esc(p)}</p>`).join('');
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const motionOK = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Русское склонение: 1 балл, 2 балла, 5 баллов
  function plural(n, [one, few, many]) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  const count = (n, forms) => `${n} ${plural(n, forms)}`;

  // Проверка условий `when` из конфига: все поля должны выполняться
  const rules = {
    minScore: (v) => state.score >= v,
    perfect: (v) => (state.correctMain === total) === v,
    streak: (v) => state.bestStreak >= v,
    egg: (v) => state.egg === v,
    picked: (list) => list.every((entry) => {
      const [id, index] = entry.split(':');
      return state.picks[id] === Number(index);
    }),
    tags: (need) => Object.entries(need).every(([tag, n]) => (state.tags[tag] || 0) >= n),
  };
  const matches = (when = {}) => Object.entries(when).every(([key, value]) => rules[key] && rules[key](value));

  function applyConfig() {
    const root = document.documentElement.style;
    Object.entries(cfg.theme.colors).forEach(([key, value]) => root.setProperty(`--${key}`, value));
    if (cfg.theme.backgroundImage) {
      root.setProperty('--bg-image', `url("${cfg.theme.backgroundImage}")`);
      document.body.classList.add('has-bg-image');
    }
    document.title = cfg.meta.title;
    document.querySelector('meta[name="description"]').content = cfg.meta.description;
    document.querySelector('meta[property="og:title"]').content = cfg.meta.title;
    document.querySelector('meta[name="theme-color"]').content = cfg.theme.colors.bg;
    document.getElementById('footer').textContent = cfg.footer || '';
  }

  // Смена экрана: старый уходит, новый появляется каскадом
  async function render(html, { bare = false } = {}) {
    const current = app.firstElementChild;
    if (current && motionOK()) {
      current.classList.add('is-leaving');
      await wait(200);
    }
    app.innerHTML = bare ? `<section class="screen">${html}</section>` : `<section class="card">${html}</section>`;
    app.querySelectorAll('.stagger').forEach((group) => {
      [...group.children].forEach((el, i) => el.style.setProperty('--i', i));
    });
    const heading = app.querySelector('h1, h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function bubble(text, { secret = false, title = '' } = {}) {
    const n = cfg.narrator;
    return `
      <div class="bubble ${secret ? 'bubble--secret' : ''}">
        ${n ? `<span class="bubble__avatar" aria-hidden="true">${secret ? '🐾' : esc(n.avatar)}</span>` : ''}
        <div class="bubble__body">
          ${title || n ? `<span class="bubble__name">${esc(title || n.name)}</span>` : ''}
          <p>${esc(text)}</p>
        </div>
      </div>`;
  }

  /* ---------- screens ---------- */

  const screens = {
    start() {
      const s = cfg.start;
      const meta = [count(total, words.questions)];
      if (achievements.length) meta.push(count(achievements.length, words.achievements));
      if (s.duration) meta.push(s.duration);
      return render(`
        <div class="stagger center">
          <img class="hero" src="${esc(cfg.theme.heroImage)}" alt="" width="200" height="200">
          <span class="eyebrow">${esc(s.eyebrow)}</span>
          <h1>${esc(s.title)}</h1>
          <p class="lead">${esc(s.subtitle)}</p>
          <ul class="meta-chips">${meta.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
          <button class="btn" data-action="intro">${esc(s.button)}</button>
        </div>`);
    },

    intro() {
      const s = cfg.intro;
      return render(`
        <div class="stagger">
          <span class="eyebrow">${esc(s.eyebrow)}</span>
          <h2>${esc(s.title)}</h2>
          <div class="text">${paragraphs(s.paragraphs)}</div>
          <button class="btn" data-action="start">${esc(s.button)}</button>
        </div>`);
    },

    question() {
      const { q, isBonus } = state.queue[state.pos];
      state.answered = false;
      const done = state.mainAnswered;
      return render(`
        <div class="progress ${isBonus ? 'progress--bonus' : ''}">
          <div class="progress__meta">
            <span>${isBonus ? `★ ${esc(ui.bonusLabel)}` : esc(ui.questionOf(done + 1, total))}</span>
            <span class="progress__score">${count(state.score, words.points)}</span>
          </div>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}">
            <div class="bar__fill" style="width:${(done / total) * 100}%"></div>
          </div>
        </div>
        <h2 class="question">
          ${q.emoji ? `<span class="question__emoji" aria-hidden="true">${q.emoji}</span>` : ''}
          ${esc(q.text)}
        </h2>
        ${isBonus && bonus.note ? `<p class="question__note">${esc(bonus.note)}</p>` : ''}
        <div class="options stagger">
          ${q.options.map((option, i) => `
            <button class="option" data-action="answer" data-index="${i}">
              <span class="option__letter">${LETTERS[i]}</span>
              <span>${esc(option.text)}</span>
            </button>`).join('')}
        </div>
        <div class="feedback-slot" aria-live="polite"></div>`);
    },

    async counting() {
      const n = cfg.narrator;
      await render(`
        <div class="counting">
          ${n ? `<span class="counting__avatar" aria-hidden="true">${esc(n.avatar)}</span>` : ''}
          <p class="counting__text">${esc(ui.counting)}</p>
          <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>`);
      await wait(motionOK() ? 1300 : 500);
    },

    result({ celebrate = true } = {}) {
      const tier = state.tier;
      const animateScore = celebrate && motionOK();
      const locked = achievements.filter((a) => !state.earned.includes(a));

      const badges = state.earned.length
        ? state.earned.map((a) => `<li class="badge"><span aria-hidden="true">${a.icon}</span>${esc(a.title)}</li>`).join('')
        : `<li class="badge badge--empty">${esc(ui.noAchievements)}</li>`;

      const lockedList = locked.map((a) => `
        <li class="locked">
          <span class="locked__icon" aria-hidden="true">${a.secret ? '?' : a.icon}</span>
          <span>
            <b>${esc(a.secret ? ui.secretTitle : a.title)}</b>
            <small>${esc(a.secret ? ui.secretText : a.text)}</small>
          </span>
        </li>`).join('');

      const collection = achievements.length ? `
        <section class="panel collection">
          ${locked.length ? `
            <h3>${esc(ui.lockedTitle)} · ${locked.length}</h3>
            <ul>${lockedList}</ul>
            <p class="collection__hint">${esc(ui.lockedHint)}</p>`
          : `<p class="collection__done">🏆 ${esc(ui.allUnlocked)}</p>`}
        </section>` : '';

      return render(`
        <div class="stagger">
          <article class="result-card" data-mood="${esc(tier.mood || 'base')}">
            <div class="result-card__top">
              <span>${esc(cfg.hero.name)} · ${esc(cfg.hero.occasion)}</span>
              <span aria-hidden="true">★</span>
            </div>
            ${tier.medal ? `<div class="medal" aria-hidden="true">${tier.medal}</div>` : ''}
            ${tier.label ? `<span class="result-card__label">${esc(tier.label)}</span>` : ''}
            <h2>${esc(tier.title)}</h2>
            <p class="result-card__text">${esc(tier.text)}</p>
            <p class="result-card__score" aria-label="${count(state.score, words.points)} из ${maxScore}">
              <span class="score__value">${animateScore ? 0 : state.score}</span>
              <span class="score__max">/ ${maxScore}</span>
            </p>
            ${achievements.length ? `<ul class="badges">${badges}</ul>` : ''}
            <div class="result-card__actions">
              <button class="btn btn--card" data-action="restart">${esc(ui.restart)}</button>
              <button class="btn btn--card-ghost" data-action="share">${esc(ui.share)}</button>
            </div>
          </article>
          <div class="letter-slot">${state.letterOpen ? letterHTML() : envelopeHTML()}</div>
          ${collection}
        </div>`, { bare: true }).then(() => {
        if (!celebrate) return;
        if (animateScore) countUp(app.querySelector('.score__value'), state.score);
        celebrateEffect(tier.celebrate);
      });
    },

    share() {
      const s = cfg.share;
      const url = s.url || window.location.href.split('#')[0];
      return render(`
        <div class="stagger center">
          <span class="eyebrow">${esc(s.eyebrow)}</span>
          <h2>${esc(s.title)}</h2>
          <p class="lead">${esc(s.text)}</p>
          <div class="qr">
            ${s.qrImage
              ? `<img src="${esc(s.qrImage)}" alt="QR-код со ссылкой на игру">`
              : `<span>${esc(s.qrPlaceholder)}</span>`}
          </div>
          <div class="link-row">
            <input class="link-input" type="text" readonly value="${esc(url)}" aria-label="Ссылка на игру">
            <button class="btn btn--small" data-action="copy">${esc(ui.copy)}</button>
          </div>
          <div class="actions">
            ${navigator.share ? `<button class="btn" data-action="native-share">${esc(ui.nativeShare)}</button>` : ''}
            <button class="btn btn--ghost" data-action="back">${esc(ui.back)}</button>
          </div>
        </div>`);
    },
  };

  function envelopeHTML() {
    return `
      <button class="envelope" data-action="letter">
        <span class="envelope__icon" aria-hidden="true">💌</span>
        <span><b>${esc(ui.envelope)}</b><small>${esc(ui.envelopeHint)}</small></span>
      </button>`;
  }

  function letterHTML() {
    const g = cfg.greeting;
    const ps = state.egg && cfg.easterEgg && cfg.easterEgg.postscript;
    return `
      <article class="panel letter">
        <h3>${esc(g.title)}</h3>
        ${paragraphs(g.paragraphs)}
        <p class="letter__sign">${esc(g.signature)}</p>
        ${ps ? `<p class="letter__ps">${esc(ps)}</p>` : ''}
      </article>`;
  }

  /* ---------- game logic ---------- */

  function startGame() {
    resetState();
    return screens.question();
  }

  function answer(choice) {
    if (state.answered) return;
    state.answered = true;

    const { q, isBonus } = state.queue[state.pos];
    const option = q.options[choice];
    const isRight = choice === q.correct;

    state.picks[q.id] = choice;
    if (option.tag) state.tags[option.tag] = (state.tags[option.tag] || 0) + 1;

    if (!isBonus) {
      state.mainAnswered += 1;
      if (isRight) {
        state.score += cfg.pointsPerCorrect;
        state.correctMain += 1;
        state.streak += 1;
        state.bestStreak = Math.max(state.bestStreak, state.streak);
      } else {
        state.streak = 0;
      }
    }

    let eggFound = false;
    if (cfg.easterEgg && !state.egg && matches(cfg.easterEgg.when)) {
      state.egg = true;
      eggFound = true;
    }

    const bonusOpens = bonus && !isBonus && q.id === bonus.after && matches(bonus.when);
    if (bonusOpens) state.queue.splice(state.pos + 1, 0, { q: bonus.question, isBonus: true });

    markOptions(q, choice);
    updateProgress(isRight && !isBonus);

    const isLast = state.pos === state.queue.length - 1;
    const verdict = isRight ? pick(ui.rightTitles) : pick(ui.wrongTitles);
    const points = isRight && !isBonus ? `<b>+${cfg.pointsPerCorrect}</b>` : '';
    const streak = !isBonus && state.streak >= 2 ? `<span class="streak">🔥 ×${state.streak}</span>` : '';
    const reply = option.reply || (isRight ? q.right : q.wrong) || '';

    const slot = app.querySelector('.feedback-slot');
    slot.innerHTML = `
      <div class="verdict ${isRight ? 'verdict--right' : 'verdict--wrong'}">${esc(verdict)} ${points}${streak}</div>
      ${reply ? bubble(reply) : ''}
      ${eggFound ? bubble(cfg.easterEgg.reply, { secret: true, title: cfg.easterEgg.title }) : ''}
      ${bonusOpens ? `<div class="unlock">★ ${esc(bonus.unlockedText)}</div>` : ''}
      <button class="btn" data-action="next">${esc(isLast ? ui.toResult : bonusOpens ? ui.toBonus : ui.next)}</button>`;

    slot.querySelectorAll(':scope > *').forEach((el, i) => el.style.setProperty('--i', i));
    slot.querySelector('.btn').focus({ preventScroll: true });
    slot.scrollIntoView({ block: 'end', behavior: motionOK() ? 'smooth' : 'auto' });
  }

  function markOptions(q, choice) {
    app.querySelectorAll('.option').forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correct) btn.classList.add('is-right');
      else if (i === choice) btn.classList.add('is-wrong');
      else btn.classList.add('is-dim');
    });
  }

  function updateProgress(gained) {
    app.querySelector('.bar__fill').style.width = `${(state.mainAnswered / total) * 100}%`;
    app.querySelector('.bar').setAttribute('aria-valuenow', state.mainAnswered);
    const score = app.querySelector('.progress__score');
    score.textContent = count(state.score, words.points);
    if (gained && motionOK()) {
      const plus = document.createElement('span');
      plus.className = 'plus';
      plus.textContent = `+${cfg.pointsPerCorrect}`;
      score.appendChild(plus);
    }
  }

  async function next() {
    state.pos += 1;
    if (state.pos < state.queue.length) return screens.question();
    finish();
    await screens.counting();
    return screens.result();
  }

  function finish() {
    state.tier = results.find((r) => state.score >= r.minScore) || results[results.length - 1];
    state.earned = achievements.filter((a) => matches(a.when));
  }

  function openLetter() {
    state.letterOpen = true;
    const slot = app.querySelector('.letter-slot');
    slot.innerHTML = letterHTML();
    slot.querySelector('.letter').scrollIntoView({ block: 'start', behavior: motionOK() ? 'smooth' : 'auto' });
  }

  /* ---------- effects ---------- */

  function countUp(el, target, duration = 1000) {
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function celebrateEffect(effect = {}) {
    if (!motionOK()) return;
    if (effect.confetti) confetti(effect.confetti);
    if (effect.float) floaters(effect.float);
  }

  function layer(className) {
    const el = document.createElement('div');
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
    return el;
  }

  function confetti(amount) {
    const c = cfg.theme.colors;
    const colors = [c.accent, c.success, c.gold || '#F2C14E', c['accent-soft'], '#F2C14E'];
    const host = layer('confetti');
    for (let i = 0; i < amount; i += 1) {
      const piece = document.createElement('i');
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = pick(colors);
      piece.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
      piece.style.animationDelay = `${Math.random() * 0.5}s`;
      piece.style.setProperty('--drift', `${Math.random() * 80 - 40}px`);
      host.appendChild(piece);
    }
  }

  function floaters(emojis) {
    const host = layer('floaters');
    for (let i = 0; i < 12; i += 1) {
      const el = document.createElement('span');
      el.textContent = pick(emojis);
      el.style.left = `${5 + Math.random() * 90}%`;
      el.style.animationDelay = `${Math.random() * 1.6}s`;
      el.style.fontSize = `${20 + Math.random() * 14}px`;
      host.appendChild(el);
    }
  }

  /* ---------- sharing ---------- */

  async function copyLink(btn) {
    const input = app.querySelector('.link-input');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    btn.textContent = ui.copied;
    setTimeout(() => { btn.textContent = ui.copy; }, 2000);
  }

  function nativeShare() {
    navigator.share({
      title: cfg.meta.title,
      text: cfg.share.text,
      url: app.querySelector('.link-input').value,
    }).catch(() => { /* пользователь закрыл окно — ничего не делаем */ });
  }

  /* ---------- wiring ---------- */

  const actions = {
    intro: () => screens.intro(),
    start: startGame,
    answer: (btn) => answer(Number(btn.dataset.index)),
    next,
    restart: startGame,
    share: () => screens.share(),
    back: () => screens.result({ celebrate: false }),
    letter: openLetter,
    copy: copyLink,
    'native-share': nativeShare,
  };

  // Пока идёт смена экрана, повторные нажатия игнорируются
  let busy = false;
  app.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn || busy || !actions[btn.dataset.action]) return;
    busy = true;
    Promise.resolve(actions[btn.dataset.action](btn)).finally(() => { busy = false; });
  });

  resetState();
  applyConfig();
  screens.start();
})();
