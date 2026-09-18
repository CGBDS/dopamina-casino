# 🎰 Dopamina Casino

Juego social de casino **online**: 6 juegos (tragamonedas, blackjack, ruleta, cara o cruz, mayor o menor, dados), monedas **virtuales**, ranking compartido, y sistemas de dopamina para que la gente vuelva: rachas diarias, misiones, ruleta de premios gratis cada 6h, torneo diario, niveles y feed en vivo.

## Probarlo local

```bash
cd ~/workspace/casino-online
npm install
node server/index.js
# abre http://localhost:3000
```

Entra como **invitado** (sin configurar nada) y juega.

## Activar login con Google (opcional, ~10 min)

1. Ve a https://console.cloud.google.com/ → crea un proyecto.
2. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth**.
3. Tipo: *Aplicación web*. En **Orígenes autorizados** pon tu dominio (ej. `https://dopamina-casino.onrender.com`). En **URIs de redirección** pon `https://dopamina-casino.onrender.com/auth/google/callback`.
4. Copia el **Client ID** y **Client Secret** y ponlos como variables de entorno:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL` (tu dominio https).

## Activar pagos con dinero real (opcional)

1. Crea cuenta en https://stripe.com/ y consigue tu **Secret key** (`sk_live_...`).
2. En el Dashboard de Stripe crea un **Webhook** apuntando a `https://tu-dominio/api/shop/webhook`, evento `checkout.session.completed`, y copia el **Webhook secret**.
3. Variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

> ⚠️ **Avisos honestos antes de cobrar:**
> - Los procesadores (Stripe, etc.) consideran los juegos estilo casino como **negocio de alto riesgo**: pueden pedir verificación extra o rechazar la cuenta. Revisa sus términos.
> - En Puerto Rico los juegos de azar están regulados. Aunque las fichas sean virtuales y sin canje por dinero, **consulta las reglas locales** antes de aceptar pagos.
> - La tienda ya exige confirmación de 18+.

## Desplegar en Render (gratis)

El `render.yaml` ya está listo: conecta el repo y Render usa `npm install` + `node server/index.js`. Pon las variables de entorno en el dashboard.

> Nota: el plan gratis de Render tiene disco efímero — si el servidor se reinicia, las sesiones se conservan (SQLite) pero conviene un disco persistente o Postgres si el juego crece.

## Estructura

- `server/index.js` — Express, auth, API
- `server/games.js` — lógica de los 6 juegos (todo en servidor, anti-trampa)
- `server/dopamine.js` — XP, rachas, misiones, ruleta gratis, torneo, feed
- `server/shop.js` — Stripe (se activa con tus claves)
- `server/db.js` — SQLite
- `public/` — interfaz (móvil primero)
