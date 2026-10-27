# NACHO Hub

Dashboard personal con agentes IA que trabajan en los negocios de 
Nacho (Ignacio Abait). Genera informes diarios automáticos y 
produce assets (banners, copies). Visual final: oficina 3D 
isométrica estilo "Seven Brand".

## Dueño y contexto

- **Nacho (Ignacio Abait)** — Dolores, Buenos Aires. Dev full-stack, 
  prefiere respuestas concisas en voseo argentino, honestidad 
  sobre validación.
- Repo: github.com/NachoAbait/nacho-hub
- URL: nacho-hub.vercel.app (Vercel, sin dominio propio por decisión del 27-10-2026)

## Dos negocios cubiertos

| | BNB Store | AgroScan |
|---|---|---|
| Qué | Reventa Apple/Samsung en Dolores | App gestión + trazabilidad ganadera |
| Estado | Activo, es el que paga | Prototipo, aún sin cobrar |
| IG | @bnbstore.dolores (16.6k) | @agroscan |
| Admin app | NexiOS (nexiosapp.com), BNB es el único tenant | PWA propia |

NACHO Hub tiene selector de contexto `[BNB] [AgroScan] [AMBOS]`. 
Cada agente lee el contexto activo y adapta su análisis.

## Arquitectura de 13 agentes en 4 TIERS

### TIER 1 — READERS (recolectan datos crudos)
1. **Price Reader** (BNB) — Lee WhatsApp de proveedores Apple/Samsung, 
   extrae `{modelo, capacidad, precio_usd}`, actualiza `products`
2. **Competitor Scraper** (BNB+Agro) — Scrapea IG de competencia, 
   guarda posts/precios/promos
3. **Market Watcher** (BNB+Agro) — Noticias Apple + dólar MEP (BNB); 
   SENASA + mercado hacienda (Agro)
4. **Social Collector** (BNB+Agro) — Métricas de IG propias vía 
   Instagram Graph API

### TIER 2 — ANALYSTS (interpretan datos)
5. **Price Analyst** (BNB) — Compara precios propios vs competencia
6. **Content Analyst** (BNB+Agro) — Qué posts rinden y por qué
7. **Ads Analyst** (BNB) — Performance Meta Ads, detecta anomalías
8. **Stock Analyst** (BNB) — Rotación, márgenes, cash flow

### TIER 3 — CREATORS (producen output)
9. **Designer** (BNB, luego Agro) — Banners automáticos (HTML + 
   Playwright). **Pipeline ya validado.**
10. **Content Creator** (BNB+Agro) — 3 ideas diarias de 
    posts/reels/stories
11. **Copy Writer** (BNB+Agro) — Captions, descripciones, respuestas 
    a DMs frecuentes

### TIER 4 — CHIEF
12. **Chief of Staff** (BNB+Agro, por contexto) — Lee a los 11 
    anteriores y arma un "Daily Brief" con 3 acciones concretas

### BONUS (Fase 3)
13. **DM Handler** (BNB) — Responde DMs rutinarios

## Flow diario (CRON Vercel)

- 03:00 ART → Readers (los 4) corren en paralelo
- 05:00 ART → Analysts procesan datos de los readers
- 06:00 ART → Creators generan outputs
- 07:00 ART → Chief lee todo y arma el Daily Brief
- 07:30 ART → Nacho entra al dashboard, tiene todo listo

## Stack técnico

- **Front/Back:** Next.js 16 (App Router) + TypeScript + Tailwind 4
- **DB:** Supabase (project nuevo `nacho-hub`, SEPARADO del de 
  BNB Store)
- **IA:** Anthropic Claude (Sonnet para análisis complejos, Haiku 
  para parsers)
- **Scheduling:** Vercel Cron
- **Banners:** `playwright-core` + `@sparticuz/chromium` para 
  Vercel serverless
- **Scraping:** HTTPS plano para IG público, Baileys para WhatsApp 
  (Price Reader, Fase 2)
- **3D (Fase 4):** React Three Fiber + @react-three/drei + 
  @react-spring/three
- **Modelos 3D:** Poly Pizza / Kenney (lowpoly gratis)

## Estructura DB (fase 1)

```sql
-- Catálogo de productos
products (
  id uuid pk,
  category text, -- iphone|ipad|macbook|watch|airpods|samsung
  model text,
  capacity text,
  price_usd numeric,
  hero_image_url text, -- PNG transparente en Supabase Storage
  display_order int,
  is_active bool,
  context text default 'BNB' -- BNB|AgroScan
)

-- Banners generados
banners (
  id uuid pk,
  category text,
  generated_at timestamptz,
  image_url text, -- PNG en Supabase Storage
  snapshot_json jsonb -- datos usados para generar
)

-- Informes diarios de agentes
agent_reports (
  id uuid pk,
  agent_name text,
  context text, -- BNB|AgroScan|AMBOS
  date date,
  content_markdown text,
  raw_data_json jsonb,
  created_at timestamptz
)
```

Más tablas van a venir cuando construyamos cada agente.

## Fases de desarrollo

- **FASE 1 (ahora):** Designer con template de iPhone funcionando 
  end-to-end + dashboard mínimo
- **FASE 2:** Resto de templates (iPad, MacBook, Watch, AirPods, 
  Samsung) + Price Reader via WhatsApp (Baileys)
- **FASE 3:** Agentes de TIER 1 y 2 (Competitor Scraper, Market 
  Watcher, Social Collector, Analysts)
- **FASE 4:** Chief of Staff + oficina 3D con React Three Fiber
- **FASE 5:** Dos pisos (BNB abajo / AgroScan arriba) con 
  transición cinematográfica

## Decisiones ya tomadas

- Pipeline de banners: HTML + Playwright + rembg (ya validado por 
  prototipo). NO usar IA generativa para los banners enteros, 
  solo para generar las imágenes hero de productos (una vez por 
  modelo).
- Supabase: proyecto NUEVO, separado del de BNB Store (ref 
  `djrsijxkjcwqrlgnlcbc`). NexiOS queda intacto.
- Visual 3D: 2 pisos con transición de cámara (BNB planta baja, 
  AgroScan arriba).

## Convenciones de código

- TypeScript estricto
- Server Components por defecto, Client solo donde se necesita
- Un endpoint por agente en `/app/api/agents/[nombre]/route.ts`
- Templates HTML de banners en `/components/banners/[category].tsx`
- Supabase client en `/lib/supabase.ts` (dos: anon y service_role)
- Toda llamada a Claude pasa por `/lib/claude.ts` (wrapper con 
  retry + logs)
