/** Ficha de tarea de cada agente: lo que se muestra al tocarlo en la oficina. */
export interface AgentBrief {
  /** Resumen en una frase, en primera persona. */
  summary: string;
  /** Pasos concretos de su tarea diaria. */
  steps: string[];
  /** De dónde saca los datos. */
  sources: string[];
  /** Qué deja hecho al terminar. */
  delivers: string;
  /** Cuándo corre (hora Argentina). */
  schedule: string;
}

export const BRIEFS: Record<string, AgentBrief> = {
  "price-reader": {
    summary: "Leo los precios que mandan los proveedores por WhatsApp y mantengo el catálogo al día.",
    steps: [
      "Reviso los mensajes nuevos de los grupos y chats de proveedores Apple y Samsung.",
      "De cada lista extraigo modelo, capacidad y precio en dólares, aunque vengan en formatos distintos.",
      "Comparo con el precio anterior y marco subas, bajas y modelos nuevos.",
      "Actualizo la tabla products para que el Designer y los analistas trabajen con precios reales.",
    ],
    sources: ["WhatsApp de proveedores (vía Baileys)", "Tabla products"],
    delivers: "Catálogo de precios actualizado y un resumen de los cambios del día.",
    schedule: "03:00, junto con los otros Readers.",
  },
  "competitor-scraper": {
    summary: "Miro qué están publicando y a qué precio venden los competidores.",
    steps: [
      "Visito los perfiles públicos de Instagram de la competencia definida para cada negocio.",
      "Guardo los posts nuevos: texto, fecha, likes y comentarios.",
      "Detecto precios, promos y lanzamientos mencionados en los posts.",
      "Dejo todo en una tabla para que Price Analyst y Content Analyst lo crucen.",
    ],
    sources: ["Instagram público de competidores", "Lista de competidores por negocio"],
    delivers: "Posts y precios de la competencia de las últimas 24 horas.",
    schedule: "03:00, junto con los otros Readers.",
  },
  "market-watcher": {
    summary: "Sigo las noticias que mueven el mercado de cada negocio.",
    steps: [
      "Para BNB: noticias de Apple, lanzamientos, y cotización del dólar MEP y blue.",
      "Para AgroScan: novedades de SENASA, precios de hacienda y normativa de trazabilidad.",
      "Filtro lo que realmente afecta al negocio y descarto el ruido.",
      "Escribo un resumen corto con lo relevante y el dato de la cotización del día.",
    ],
    sources: ["Portales de noticias", "Cotizaciones del dólar", "SENASA y mercados ganaderos"],
    delivers: "Resumen de mercado del día con cotizaciones.",
    schedule: "03:00, junto con los otros Readers.",
  },
  "social-collector": {
    summary: "Traigo las métricas de nuestras propias cuentas de Instagram.",
    steps: [
      "Consulto la Graph API de Instagram de @bnbstore.dolores y @agroscan.",
      "Bajo alcance, impresiones, seguidores nuevos y rendimiento de cada post y reel.",
      "Guardo el histórico para poder comparar semana contra semana.",
    ],
    sources: ["Instagram Graph API de las cuentas propias"],
    delivers: "Métricas del día y variación contra los últimos 7 días.",
    schedule: "03:00, junto con los otros Readers.",
  },
  "price-analyst": {
    summary: "Comparo nuestros precios contra la competencia y aviso dónde estamos caros o baratos.",
    steps: [
      "Tomo el catálogo que actualizó Lucas y los precios que juntó Sofía.",
      "Emparejo modelo por modelo y calculo la diferencia porcentual.",
      "Marco los productos donde estamos fuera de mercado o donde hay margen para subir.",
      "Sugiero ajustes concretos con el número recomendado.",
    ],
    sources: ["Tabla products", "Precios de competidores", "Dólar del día"],
    delivers: "Informe de posición de precios con sugerencias de ajuste.",
    schedule: "05:00, después de los Readers.",
  },
  "content-analyst": {
    summary: "Analizo qué contenido rinde y por qué, nuestro y de la competencia.",
    steps: [
      "Cruzo las métricas propias que trajo Valentina con los posts de competidores de Sofía.",
      "Identifico formatos, horarios y temas que mejor funcionan.",
      "Detecto qué está haciendo la competencia que a nosotros nos falta.",
      "Dejo conclusiones accionables para Content Creator y Copy Writer.",
    ],
    sources: ["Métricas de Instagram propias", "Posts de competidores"],
    delivers: "Informe de rendimiento de contenido con 3 aprendizajes del día.",
    schedule: "05:00, después de los Readers.",
  },
  "ads-analyst": {
    summary: "Vigilo las campañas de Meta Ads y aviso si algo se desvía.",
    steps: [
      "Leo gasto, alcance, clics y costo por resultado de cada campaña activa.",
      "Comparo contra el promedio de los últimos días y detecto anomalías.",
      "Aviso si una campaña se está quemando plata o si otra merece más presupuesto.",
    ],
    sources: ["Meta Ads API"],
    delivers: "Reporte de performance de ads con alertas.",
    schedule: "05:00, después de los Readers.",
  },
  "stock-analyst": {
    summary: "Miro rotación, márgenes y caja para que no falte ni sobre stock.",
    steps: [
      "Leo stock, ventas y costos desde NexiOS.",
      "Calculo rotación por modelo y margen real por venta.",
      "Detecto modelos que no se mueven y modelos que se agotan rápido.",
      "Proyecto el flujo de caja de las próximas semanas.",
    ],
    sources: ["NexiOS (ventas, stock, costos)"],
    delivers: "Informe de stock y caja con recomendaciones de reposición.",
    schedule: "05:00, después de los Readers.",
  },
  designer: {
    summary: "Armo los banners de precios listos para publicar, con los datos reales del catálogo.",
    steps: [
      "Leo los productos activos de la categoría, ordenados como vos los configuraste.",
      "Renderizo el template HTML de la categoría con esos precios y las fotos sin fondo.",
      "Saco una captura en alta resolución con Playwright y la subo a Storage.",
      "Guardo el banner con una copia exacta de los datos usados, para saber qué se publicó.",
    ],
    sources: ["Tabla products", "Fotos en el bucket heroes"],
    delivers: "Un PNG de 1080×1350 por categoría, listo para Instagram y WhatsApp.",
    schedule: "06:00, y cuando apretás Regenerar.",
  },
  "content-creator": {
    summary: "Propongo tres ideas de contenido por día, listas para producir.",
    steps: [
      "Leo las conclusiones de Camila sobre qué contenido está rindiendo.",
      "Tomo las novedades de mercado de Tomás y los cambios de precio del día.",
      "Genero tres ideas concretas: formato, gancho, estructura y llamado a la acción.",
      "Las ordeno por potencial y esfuerzo de producción.",
    ],
    sources: ["Informe de Content Analyst", "Resumen de mercado", "Catálogo"],
    delivers: "Tres ideas de post, reel o historia con guion corto.",
    schedule: "06:00, junto con los otros Creators.",
  },
  "copy-writer": {
    summary: "Escribo los textos: captions, descripciones y respuestas a las preguntas frecuentes.",
    steps: [
      "Redacto el caption de cada idea que propuso Agustina, en el tono de la marca.",
      "Escribo descripciones de producto para el catálogo y los banners.",
      "Preparo respuestas modelo para las consultas que más se repiten por DM.",
    ],
    sources: ["Ideas de Content Creator", "Catálogo", "Historial de consultas"],
    delivers: "Textos listos para copiar y pegar.",
    schedule: "06:00, junto con los otros Creators.",
  },
  "dm-handler": {
    summary: "Respondo los mensajes rutinarios de Instagram para que vos atiendas solo los importantes.",
    steps: [
      "Leo los DMs nuevos y clasifico: precio, stock, envío, garantía u otro.",
      "Respondo los rutinarios con los textos de Facundo y los precios del catálogo.",
      "Derivo a vos los que necesitan una decisión o una negociación.",
    ],
    sources: ["DMs de Instagram", "Catálogo", "Respuestas modelo"],
    delivers: "DMs rutinarios respondidos y una lista de los que requieren atención.",
    schedule: "Varias veces por día (Fase 3).",
  },
  "chief-of-staff": {
    summary: "Leo el trabajo de todo el equipo y te dejo un resumen con tres acciones para hoy.",
    steps: [
      "Recorro los informes del día de los 11 agentes del negocio seleccionado.",
      "Detecto lo urgente: precios fuera de mercado, campañas desviadas, stock crítico.",
      "Escribo el Daily Brief: qué pasó, qué importa y tres acciones concretas, ordenadas.",
      "Lo dejo listo para que a las 07:30 lo leas en un minuto.",
    ],
    sources: ["Informes de todos los agentes del día"],
    delivers: "Daily Brief con tres acciones concretas.",
    schedule: "07:00, cuando terminaron todos los demás.",
  },
};
