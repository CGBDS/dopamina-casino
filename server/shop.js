// Tienda: paquetes de monedas virtuales con dinero real (Stripe).
// Sin STRIPE_SECRET_KEY configurado, la tienda muestra modo "próximamente".
// Las monedas son VIRTUALES: sin valor monetario y sin canje por dinero.

const PACKS = [
  { id: 'pack_mini', coins: 10000, price: 99, name: 'Puñado de fichas', emoji: '🪙' },
  { id: 'pack_mid', coins: 65000, price: 499, name: 'Cubo de fichas', emoji: '💰' },
  { id: 'pack_max', coins: 160000, price: 999, name: 'Bóveda de fichas', emoji: '🏦' },
];

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

async function createCheckout(user, packId, baseUrl) {
  const stripe = stripeClient();
  if (!stripe) return { ok: false, reason: 'not_configured' };
  const pack = PACKS.find(p => p.id === packId);
  if (!pack) return { ok: false, reason: 'bad_pack' };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `Dopamina Casino — ${pack.name} (${pack.coins.toLocaleString('es')} fichas virtuales)` },
        unit_amount: pack.price,
      },
      quantity: 1,
    }],
    metadata: { userId: String(user.id), pack: pack.id, coins: String(pack.coins) },
    success_url: `${baseUrl}/?shop=ok`,
    cancel_url: `${baseUrl}/?shop=cancel`,
  });
  const { Q } = require('./db');
  Q.createPurchase.run(user.id, session.id, pack.id, pack.coins, 'pending');
  return { ok: true, url: session.url };
}

async function handleWebhook(req, res) {
  const stripe = stripeClient();
  if (!stripe) return res.status(400).send('stripe no configurado');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send('firma inválida');
  }
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const { Q } = require('./db');
    const existing = Q.getPurchase.get(s.id);
    if (existing && existing.status === 'pending') {
      Q.completePurchase.run(s.id);
      Q.addCoins.run(parseInt(s.metadata.coins, 10), parseInt(s.metadata.userId, 10));
    }
  }
  res.json({ ok: true });
}

module.exports = { PACKS, createCheckout, handleWebhook, configured: () => !!stripeClient() };
