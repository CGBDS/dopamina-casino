// Lógica de juegos. Todo se calcula en el servidor: el cliente solo anima.
// Mult = multiplicador sobre la apuesta (lo que se devuelve, apuesta incluida).

function rnd(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rnd(arr.length)]; }

// ---------- TRAGAMONEDAS ----------
const SLOT_SYMBOLS = ['7️⃣', '💎', '🔔', '⭐', '🍒', '🍋'];
// pesos: menos peso = más raro
const SLOT_W = [1, 2, 3, 4, 6, 7];
const SLOT_PAY = { '7️⃣': 100, '💎': 40, '🔔': 20, '⭐': 10, '🍒': 6, '🍋': 6 };
function slotSymbol() {
  const total = SLOT_W.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < SLOT_SYMBOLS.length; i++) { r -= SLOT_W[i]; if (r <= 0) return SLOT_SYMBOLS[i]; }
  return '🍋';
}
function playSlots(bet) {
  const reels = [slotSymbol(), slotSymbol(), slotSymbol()];
  let mult = 0, label = '';
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    mult = SLOT_PAY[reels[0]];
    label = `¡TRIPLE ${reels[0]}! x${mult}`;
  } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    mult = 1; label = 'Pareja: recuperas tu apuesta';
  }
  return { reels, mult, win: Math.floor(bet * mult), label };
}

// ---------- BLACKJACK ----------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1);[d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function handValue(hand) {
  let v = 0, aces = 0;
  for (const c of hand) {
    if (c.r === 'A') { aces++; v += 11; }
    else if (['J', 'Q', 'K'].includes(c.r)) v += 10;
    else v += parseInt(c.r, 10);
  }
  while (v > 21 && aces > 0) { v -= 10; aces--; }
  return v;
}
function bjStart(bet) {
  const deck = newDeck();
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];
  const pv = handValue(player);
  if (pv === 21) {
    return { state: null, done: true, player, dealer, mult: 2.5, label: '¡BLACKJACK! x2.5' };
  }
  return { state: { deck, player, dealer }, done: false, player, dealerHidden: dealer[0] };
}
function bjHit(state) {
  state.player.push(state.deck.pop());
  const v = handValue(state.player);
  if (v > 21) return { state: null, done: true, player: state.player, dealer: state.dealer, mult: 0, label: `Te pasaste (${v})` };
  if (v === 21) return bjStand(state);
  return { state, done: false, player: state.player, dealerHidden: state.dealer[0] };
}
function bjStand(state) {
  const dv = handValue(state.dealer);
  let dealer = state.dealer, deck = state.deck;
  let dval = dv;
  while (dval < 17) { dealer.push(deck.pop()); dval = handValue(dealer); }
  const pval = handValue(state.player);
  let mult, label;
  if (dval > 21) { mult = 2; label = `Dealer se pasó (${dval}). ¡Ganas! x2`; }
  else if (dval > pval) { mult = 0; label = `Dealer ${dval} vs tú ${pval}. Pierdes`; }
  else if (dval < pval) { mult = 2; label = `¡${pval} vs ${dval}! ¡Ganas! x2`; }
  else { mult = 1; label = `Empate a ${pval}: recuperas tu apuesta`; }
  return { state: null, done: true, player: state.player, dealer, mult, label };
}

// ---------- RULETA (europea simplificada) ----------
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function playRoulette(bet, type, num) {
  const n = rnd(37);
  const color = n === 0 ? 'green' : (REDS.has(n) ? 'red' : 'black');
  let mult = 0;
  if (type === 'number' && num === n) mult = 36;
  else if (type === 'red' && color === 'red') mult = 2;
  else if (type === 'black' && color === 'black') mult = 2;
  else if (type === 'even' && n !== 0 && n % 2 === 0) mult = 2;
  else if (type === 'odd' && n % 2 === 1) mult = 2;
  else if (type === 'low' && n >= 1 && n <= 18) mult = 2;
  else if (type === 'high' && n >= 19 && n <= 36) mult = 2;
  return { number: n, color, mult, win: Math.floor(bet * mult) };
}

// ---------- CARA O CRUZ ----------
function playCoinflip(bet, choice) {
  const result = Math.random() < 0.5 ? 'cara' : 'cruz';
  const mult = result === choice ? 2 : 0;
  return { result, mult, win: Math.floor(bet * mult) };
}

// ---------- MAYOR O MENOR ----------
function drawCard() { return 1 + rnd(13); } // 1=A .. 11=J 12=Q 13=K
function cardName(v) { return v === 1 ? 'A' : v === 11 ? 'J' : v === 12 ? 'Q' : v === 13 ? 'K' : String(v); }
function hiloNew() { const c = drawCard(); return { card: c, name: cardName(c) }; }
function hiloGuess(bet, current, guess) {
  const next = drawCard();
  let mult = 0, label;
  if (next === current) { mult = 0; label = `¡Empate con ${cardName(next)}! La casa gana`; }
  else if ((guess === 'higher' && next > current) || (guess === 'lower' && next < current)) {
    mult = 1.3; label = `${cardName(current)} → ${cardName(next)}. ¡Acertaste! x1.3`;
  } else { mult = 0; label = `${cardName(current)} → ${cardName(next)}. Fallaste`; }
  return { next, nextName: cardName(next), mult, win: Math.floor(bet * mult), label };
}

// ---------- DADOS (2d6 vs la casa) ----------
function playDice(bet) {
  const p = [1 + rnd(6), 1 + rnd(6)], h = [1 + rnd(6), 1 + rnd(6)];
  const ps = p[0] + p[1], hs = h[0] + h[1];
  let mult, label;
  if (ps > hs) { mult = 1.9; label = `${ps} vs ${hs}. ¡Ganas! x1.9`; }
  else if (ps < hs) { mult = 0; label = `${ps} vs ${hs}. Pierdes`; }
  else { mult = 1; label = `Empate a ${ps}: recuperas tu apuesta`; }
  return { player: p, house: h, mult, win: Math.floor(bet * mult), label };
}

module.exports = {
  playSlots, bjStart, bjHit, bjStand, handValue,
  playRoulette, playCoinflip, hiloNew, hiloGuess, playDice,
};
