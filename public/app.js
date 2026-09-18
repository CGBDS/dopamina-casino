// Dopamina Casino — frontend
const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('es');
let ME = null, BET = 100, ROUL_TYPE = 'red', CUR_GAME = null;

// ---------- sonidos (WebAudio, sin archivos) ----------
let AC = null;
function beep(f, d = .12, t = 0) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    o.frequency.value = f; o.type = 'sine';
    const s = AC.currentTime + t;
    g.gain.setValueAtTime(.18, s); g.gain.exponentialRampToValueAtTime(.001, s + d);
    o.start(s); o.stop(s + d);
  } catch (e) {}
}
const sfxClick = () => beep(600, .06);
const sfxWin = () => { beep(523, .12); beep(659, .12, .1); beep(784, .2, .2); };
const sfxBig = () => { [523, 659, 784, 1046, 1318].forEach((f, i) => beep(f, .18, i * .11)); };
const sfxLose = () => beep(220, .2);

// ---------- API ----------
async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { showLogin(); return { error: 'login' }; }
  return r.json();
}

// ---------- arranque ----------
boot();
async function boot() {
  const st = await api('/api/auth/status');
  if (st.googleEnabled) { $('btn-google').classList.remove('hidden'); $('btn-google').onclick = () => location.href = '/auth/google'; }
  $('btn-guest').onclick = async () => {
    sfxClick();
    const r = await api('/api/auth/guest', { name: $('guest-name').value || 'Jugador' });
    if (r.ok) enterApp(r.me);
  };
  const me = await api('/api/me');
  if (me && me.me) enterApp(me.me); else showLogin();
}
function showLogin() { $('view-login').classList.remove('hidden'); $('view-app').classList.add('hidden'); }
function enterApp(me) {
  ME = me;
  $('view-login').classList.add('hidden'); $('view-app').classList.remove('hidden');
  updateHeader(); refreshLobby(); startLoops();
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { sfxClick(); switchTab(b.dataset.tab); });
  document.querySelectorAll('.game-card').forEach(b => b.onclick = () => { sfxClick(); openGame(b.dataset.game); });
  document.querySelectorAll('.bets button').forEach(b => b.onclick = () => { sfxClick(); BET = +b.dataset.bet; document.querySelectorAll('.bets button').forEach(x => x.classList.toggle('sel', x === b)); });
  $('btn-back').onclick = () => { sfxClick(); switchTab('juegos'); };
  $('btn-claim').onclick = claimDaily;
  $('btn-wheel').onclick = openWheel;
  $('modal-ok').onclick = () => $('modal').classList.add('hidden');
  bindGames();
}

// ---------- header / tabs ----------
function updateHeader() {
  $('u-name').textContent = ME.name;
  $('u-avatar').textContent = ME.avatar ? '🙂' : '🙂';
  $('u-coins').textContent = fmt(ME.coins);
  $('u-level').textContent = 'Nv ' + ME.level;
  $('lvl-fill').style.width = Math.min(100, (ME.xp / ME.nextLevelXp) * 100) + '%';
  if (ME.streak > 0) { $('streak-chip').classList.remove('hidden'); $('u-streak').textContent = ME.streak; }
  $('claim-banner').classList.toggle('hidden', !ME.canClaim);
}
function switchTab(t) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  ['juegos', 'misiones', 'ranking', 'tienda', 'game'].forEach(x => $('tab-' + x).classList.add('hidden'));
  $('tab-' + t).classList.remove('hidden');
  if (t === 'misiones') renderMissions();
  if (t === 'ranking') renderRanking();
  if (t === 'tienda') renderShop();
}
function openGame(g) {
  CUR_GAME = g;
  switchTab('game');
  document.querySelectorAll('.game-pane').forEach(p => p.classList.add('hidden'));
  $('game-' + g).classList.remove('hidden');
  $('game-title').textContent = { slots: '🎰 Tragamonedas', blackjack: '🃏 Blackjack', roulette: '🎡 Ruleta', coinflip: '🪙 Cara o cruz', hilo: '🔼 Mayor o menor', dice: '🎲 Dados' }[g];
  $('streak-line').classList.add('hidden');
}
function showModal(emoji, title, text) {
  $('modal-emoji').textContent = emoji; $('modal-title').textContent = title; $('modal-text').textContent = text;
  $('modal').classList.remove('hidden');
}

// ---------- post-jugada ----------
function afterPlay(r, bet, msgEl, gameLabel) {
  if (r.error) { setMsg(msgEl, r.error, 'lose'); sfxLose(); return null; }
  ME.coins = r.balance; ME.xp = r.xp; ME.level = r.level;
  updateHeader();
  const won = r.win > bet;
  if (won) {
    setMsg(msgEl, `+${fmt(r.win)}${r.bonus ? ` (bono racha +${fmt(r.bonus)})` : ''}${r.label ? ' · ' + r.label : ''}`, 'win');
    if (r.mult >= 8 || r.win >= 3000) { confetti({ particleCount: 160, spread: 100, origin: { y: .6 } }); sfxBig(); }
    else { confetti({ particleCount: 40, spread: 60, origin: { y: .7 } }); sfxWin(); }
  } else if (r.win === bet) { setMsg(msgEl, 'Recuperas tu apuesta' + (r.label ? ' · ' + r.label : ''), ''); sfxClick(); }
  else { setMsg(msgEl, r.label || `Perdiste ${fmt(bet)}`, 'lose'); sfxLose(); }
  if (r.streak >= 2) { $('streak-line').classList.remove('hidden'); $('win-streak').textContent = r.streak; $('streak-bonus').textContent = Math.min(r.streak, 10) * 2; }
  else $('streak-line').classList.add('hidden');
  if (r.levelUp) setTimeout(() => { showModal('⭐', `¡Nivel ${r.levelUp.level}!`, `+${fmt(r.levelUp.reward)} fichas de recompensa. Sigue así.`); sfxBig(); }, 600);
  if (r.missionsDone && r.missionsDone.length) setTimeout(() => showModal('🎯', '¡Misión completada!', 'Ve a la pestaña Misiones a reclamar tu premio.'), 1200);
  return r;
}
function setMsg(el, t, cls) { el.textContent = t; el.className = 'msg ' + cls; }

// ---------- juegos ----------
function bindGames() {
  // slots
  $('btn-spin').onclick = async () => {
    const btn = $('btn-spin'); btn.disabled = true;
    ['r0', 'r1', 'r2'].forEach(id => $(id).parentElement.classList.add('spinning'));
    const syms = ['7️⃣', '💎', '🔔', '⭐', '🍒', '🍋'];
    const iv = setInterval(() => ['r0', 'r1', 'r2'].forEach(id => $(id).textContent = syms[Math.floor(Math.random() * syms.length)]), 90);
    beep(400, .05);
    const r = await api('/api/play/slots', { bet: BET });
    setTimeout(() => {
      clearInterval(iv);
      if (r.error) { $('r0').textContent = '🎰'; $('r1').textContent = '🎰'; $('r2').textContent = '🎰'; }
      else r.reels.forEach((s, i) => setTimeout(() => { $('r' + i).textContent = s; beep(500 + i * 150, .08); }, i * 260));
      document.querySelector('.slots').classList.remove('spinning');
      setTimeout(() => { afterPlay(r, BET, $('slots-msg')); btn.disabled = false; }, 900);
    }, 900);
  };
  // blackjack
  const cardHTML = c => `<div class="card-p ${c.s === '♥' || c.s === '♦' ? 'red' : ''}">${c.r}<br>${c.s}</div>`;
  const renderBJ = (p, d, hideSecond) => {
    $('bj-player').innerHTML = p.map(cardHTML).join('');
    $('bj-pval').textContent = '(' + MEbjVal(p) + ')';
    $('bj-dealer').innerHTML = hideSecond ? cardHTML(d[0]) + '<div class="card-p back">?</div>' : d.map(cardHTML).join('');
    $('bj-dval').textContent = hideSecond ? '' : '(' + MEbjVal(d) + ')';
  };
  const MEbjVal = hand => { let v = 0, a = 0; hand.forEach(c => { if (c.r === 'A') { a++; v += 11; } else if ('JQK'.includes(c.r)) v += 10; else v += +c.r; }); while (v > 21 && a) { v -= 10; a--; } return v; };
  $('bj-deal').onclick = async () => {
    const r = await api('/api/blackjack/start', { bet: BET });
    if (r.error) { setMsg($('bj-msg'), r.error, 'lose'); return; }
    $('bj-deal').classList.add('hidden'); $('bj-hit').classList.remove('hidden'); $('bj-stand').classList.remove('hidden');
    setMsg($('bj-msg'), '', '');
    if (r.done) { renderBJ(r.player, r.dealer); endBJ(r); }
    else renderBJ(r.player, [r.dealerHidden, { r: '?', s: '?' }], true);
  };
  const endBJ = r => {
    $('bj-hit').classList.add('hidden'); $('bj-stand').classList.add('hidden'); $('bj-deal').classList.remove('hidden');
    afterPlay(r, BET, $('bj-msg'));
  };
  $('bj-hit').onclick = async () => { const r = await api('/api/blackjack/hit', {}); if (r.done) { renderBJ(r.player, r.dealer); endBJ(r); } else renderBJ(r.player, [r.dealerHidden, { r: '?', s: '?' }], true); };
  $('bj-stand').onclick = async () => { const r = await api('/api/blackjack/stand', {}); renderBJ(r.player, r.dealer); endBJ(r); };
  // ruleta
  document.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { sfxClick(); ROUL_TYPE = b.dataset.rt; document.querySelectorAll('[data-rt]').forEach(x => x.classList.toggle('sel', x === b)); $('roul-number').value = ''; });
  $('btn-roul').onclick = async () => {
    const numVal = $('roul-number').value;
    const body = numVal !== '' ? { bet: BET, type: 'number', number: +numVal } : { bet: BET, type: ROUL_TYPE };
    const el = $('roul-num'); let ticks = 0;
    const iv = setInterval(() => { el.textContent = Math.floor(Math.random() * 37); el.className = 'roul-num'; ticks++; if (ticks > 14) clearInterval(iv); }, 70);
    const r = await api('/api/play/roulette', body);
    setTimeout(() => {
      clearInterval(iv);
      if (!r.error) { el.textContent = r.number; el.classList.add(r.color); }
      afterPlay(r, BET, $('roul-msg'));
    }, 1100);
  };
  // coinflip
  const flip = async choice => {
    const c = $('coin'); c.classList.remove('flip'); void c.offsetWidth; c.classList.add('flip');
    const r = await api('/api/play/coinflip', { bet: BET, choice });
    setTimeout(() => { c.textContent = r.error ? '🪙' : (r.result === 'cara' ? '😀' : '👑'); afterPlay(r, BET, $('cf-msg')); }, 550);
  };
  $('cf-cara').onclick = () => flip('cara'); $('cf-cruz').onclick = () => flip('cruz');
  // hilo
  $('hilo-new').onclick = async () => { const r = await api('/api/hilo/new', {}); if (!r.error) { $('hilo-card').textContent = r.name; setMsg($('hilo-msg'), '¿La siguiente es mayor o menor?', ''); sfxClick(); } };
  const hiloGuess = async g => {
    const r = await api('/api/hilo/guess', { bet: BET, guess: g });
    if (!r.error) $('hilo-card').textContent = r.nextName;
    afterPlay(r, BET, $('hilo-msg'));
  };
  $('hilo-hi').onclick = () => hiloGuess('higher'); $('hilo-lo').onclick = () => hiloGuess('lower');
  // dados
  const die = d => ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][d - 1];
  $('btn-dice').onclick = async () => {
    const iv = setInterval(() => { $('dice-p').textContent = die(1 + Math.floor(Math.random() * 6)) + die(1 + Math.floor(Math.random() * 6)); $('dice-h').textContent = die(1 + Math.floor(Math.random() * 6)) + die(1 + Math.floor(Math.random() * 6)); }, 90);
    const r = await api('/api/play/dice', { bet: BET });
    setTimeout(() => { clearInterval(iv); if (!r.error) { $('dice-p').textContent = r.player.map(die).join(''); $('dice-h').textContent = r.house.map(die).join(''); } afterPlay(r, BET, $('dice-msg')); }, 800);
  };
}

// ---------- lobby ----------
async function refreshLobby() {
  const me = await api('/api/me'); if (me && me.me) { ME = me.me; updateHeader(); }
  const f = await api('/api/feed');
  if (f && f.feed) $('feed-items').innerHTML = f.feed.length ? f.feed.map(x => `<div>⚡ ${x.text}</div>`).join('') : '<div class="muted">Sé la primera leyenda del casino…</div>';
  updateWheelSub(); tournCountdown();
}
async function claimDaily() {
  const r = await api('/api/claim', {});
  if (r.ok) { ME.coins = r.balance; ME.streak = r.streak; ME.canClaim = false; updateHeader(); showModal('🎁', `¡Bono reclamado!`, `+${fmt(r.reward)} fichas · Racha: ${r.streak} día(s)`); sfxBig(); confetti({ particleCount: 80, spread: 70 }); }
  else showModal('🎁', 'Vuelve mañana', `Racha actual: ${r.streak} día(s)`);
}
async function updateWheelSub() {
  const w = await api('/api/wheel');
  $('wheel-sub').textContent = w.ready ? '¡Gira ya!' : 'Vuelve en ' + msToClock(w.waitMs);
  $('btn-wheel').dataset.ready = w.ready;
}
async function openWheel() {
  if ($('btn-wheel').dataset.ready !== 'true') { const w = await api('/api/wheel'); showModal('🎡', 'Aún no', 'Vuelve en ' + msToClock(w.waitMs)); return; }
  const r = await api('/api/wheel', {});
  if (r.ok) { ME.coins = r.balance; updateHeader(); updateWheelSub(); showModal('🎡', '¡Premio!', `Ganaste +${fmt(r.prize)} fichas gratis`); sfxBig(); confetti({ particleCount: 120, spread: 90 }); }
}
function msToClock(ms) { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return `${h}h ${m}m`; }
function tournCountdown() {
  const now = new Date(), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const ms = end - now, h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3);
  $('tourn-sub').textContent = `Termina en ${h}h ${m}m`;
}

// ---------- misiones ----------
async function renderMissions() {
  $('m-streak').textContent = ME.streak;
  const r = await api('/api/missions');
  $('missions-list').innerHTML = r.missions.map(m => `
    <div class="card mission"><div style="flex:1"><b>${m.text}</b><div class="bar"><i style="width:${(m.progress / m.target) * 100}%"></i></div>
    <small class="muted">${Math.min(m.progress, m.target)}/${m.target} · premio ${fmt(m.reward)}</small></div>
    ${m.claimed ? '<small>✅</small>' : `<button ${m.done ? '' : 'disabled'} data-m="${m.id}">${m.done ? 'Reclamar' : 'En curso'}</button>`}</div>`).join('');
  document.querySelectorAll('[data-m]').forEach(b => b.onclick = async () => {
    const c = await api('/api/missions/claim', { id: b.dataset.m });
    if (c.ok) { ME.coins = c.balance; updateHeader(); sfxWin(); confetti({ particleCount: 60, spread: 60 }); renderMissions(); }
  });
}

// ---------- ranking ----------
async function renderRanking() {
  const r = await api('/api/leaderboard');
  const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  $('rank-tourn').innerHTML = r.tournament.length ? r.tournament.map((t, i) => `<div class="rank-row"><span class="pos">${medal(i)}</span><span>${t.name}</span><span class="amt">+${fmt(t.profit)} → premio ${fmt(t.prize)}</span></div>`).join('') : '<p class="muted">Nadie ha jugado hoy. ¡Sé el primero!</p>';
  $('rank-coins').innerHTML = r.byCoins.map((t, i) => `<div class="rank-row"><span class="pos">${medal(i)}</span><span>${t.name}</span><small class="muted">Nv ${t.level}</small><span class="amt">🪙 ${fmt(t.coins)}</span></div>`).join('');
  $('rank-wins').innerHTML = r.byWin.length ? r.byWin.map((t, i) => `<div class="rank-row"><span class="pos">${medal(i)}</span><span>${t.name}</span><span class="amt">+${fmt(t.biggest_win)}</span></div>`).join('') : '<p class="muted">Sin ganancias grandes aún.</p>';
}

// ---------- tienda ----------
async function renderShop() {
  const r = await api('/api/shop');
  if (!r.configured) {
    $('shop-note').innerHTML = '💳 <b>Pagos con dinero real próximamente.</b><br><small class="muted">Mientras tanto juega gratis con tu bono diario, misiones y la ruleta gratis.</small>';
    $('packs').innerHTML = '';
    return;
  }
  $('shop-note').innerHTML = '💳 Compra fichas <b>virtuales</b> para jugar más. Sin valor monetario, sin canje por dinero. 🔞 18+.';
  $('packs').innerHTML = r.packs.map(p => `<div class="card pack"><div class="emoji">${p.emoji}</div><h3>${p.name}</h3><div class="coins">🪙 ${fmt(p.coins)}</div><button class="btn-primary" data-pack="${p.id}">Comprar $${(p.price / 100).toFixed(2)}</button></div>`).join('');
  document.querySelectorAll('[data-pack]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Tienes 18 años o más? Las fichas son virtuales, sin valor monetario.')) return;
    const c = await api('/api/shop/checkout', { pack: b.dataset.pack });
    if (c.url) location.href = c.url; else alert('No se pudo iniciar el pago.');
  });
}

// ---------- loops ----------
function startLoops() {
  setInterval(refreshLobby, 20000);
  setInterval(tournCountdown, 60000);
}
