/*!
 * Ecowitt WS90 Card
 * Carte Lovelace personnalisée pour Home Assistant dédiée à une station
 * météo Ecowitt WS90 (intégration Ecowitt locale).
 *
 * - Vue "Instantané" : valeurs en direct + records de la station
 * - Vue "Historique" : graphiques (température, humidité, vent, pluie,
 *   luminosité/UV) avec période sélectionnable (24h / 7j / 30j / 1an) et
 *   min/max affichés sur chaque graphique
 *
 * Ne dépend d'aucune librairie externe : les graphiques sont dessinés en
 * Canvas 2D natif, ce qui rend la carte totalement autonome (donc plus
 * simple à distribuer et installer via HACS).
 *
 * Les données historiques sont lues via l'API des "long-term statistics"
 * de Home Assistant (recorder/statistics_during_period), qui sont
 * conservées indéfiniment par défaut (contrairement à l'historique brut,
 * purgé après quelques jours). C'est aussi ce qui permet de calculer les
 * vrais records de la station sans automation ni helper additionnel.
 */

/* ============================================================================
 * Constantes
 * ==========================================================================*/

const CARD_TAG = "ecowitt-ws90-card";
const EDITOR_TAG = "ecowitt-ws90-card-editor";

const PERIODS = [
  { key: "24h", label: "24 h", hours: 24, statPeriod: "5minute" },
  { key: "7d", label: "7 j", hours: 24 * 7, statPeriod: "hour" },
  { key: "30d", label: "30 j", hours: 24 * 30, statPeriod: "hour" },
  { key: "1y", label: "1 an", hours: 24 * 365, statPeriod: "hour" },
];

// Champs d'entités attendus dans la config, avec libellé + unité par défaut
const ENTITY_FIELDS = [
  { key: "temperature", label: "Température", unit: "°C" },
  { key: "humidity", label: "Humidité", unit: "%" },
  { key: "wind_speed", label: "Vitesse du vent", unit: "km/h" },
  { key: "wind_gust", label: "Rafales", unit: "km/h" },
  { key: "wind_direction", label: "Direction du vent", unit: "°" },
  { key: "rain_rate", label: "Intensité de pluie", unit: "mm/h" },
  { key: "rain_daily", label: "Cumul de pluie (jour)", unit: "mm" },
  { key: "solar_radiation", label: "Luminosité", unit: "W/m²" },
  { key: "uv_index", label: "Index UV", unit: "" },
  { key: "pressure", label: "Pression atmosphérique", unit: "hPa" },
];

// Couleur unique des graphiques : reprend la couleur principale du thème HA
// actif (--primary-color), donc elle suit automatiquement les thèmes
// clair/sombre/personnalisés. Surchargeable via card-mod (--ecowitt-color).
const THEME_COLOR = { css: "--ecowitt-color", fallback: "#03A9F4" };

// Classes de vitesse pour la rose des vents (bornes hautes en km/h) : toutes
// dessinées avec la même couleur de thème, à des opacités croissantes pour
// distinguer les intensités.
const WIND_ROSE_SPEED_BINS = [5, 10, 20, Infinity];
const WIND_ROSE_SPEED_LABELS = ["0-5 km/h", "5-10 km/h", "10-20 km/h", "> 20 km/h"];
const WIND_ROSE_OPACITIES = [0.3, 0.55, 0.8, 1];
const WIND_ROSE_SECTORS = 16;

// Stocke les métadonnées de tracé (échelle temps/valeur) de chaque canvas,
// pour permettre l'infobulle au survol sans redessiner.
const CHART_DATA = new WeakMap();

// Périodes disponibles pour les mini-graphiques (vue instantanée)
const MINI_PERIODS = [
  { key: "1h", label: "1 h", hours: 1, statPeriod: "5minute" },
  { key: "6h", label: "6 h", hours: 6, statPeriod: "5minute" },
  { key: "12h", label: "12 h", hours: 12, statPeriod: "5minute" },
  { key: "24h", label: "24 h", hours: 24, statPeriod: "5minute" },
  { key: "48h", label: "48 h", hours: 48, statPeriod: "hour" },
  { key: "7d", label: "7 j", hours: 24 * 7, statPeriod: "hour" },
];

// Icônes + agrégat statistique utilisés pour les mini-graphiques restants
// (température et humidité passent désormais dans le graphe combiné dédié ;
// le vent utilise la boussole plutôt qu'un mini-graphique)
const MINI_GRAPH_FIELDS = [
  { key: "uv_index", icon: "mdi:sun-wireless", agg: "max" },
  { key: "solar_radiation", icon: "mdi:white-balance-sunny", agg: "mean" },
  { key: "pressure", icon: "mdi:gauge", agg: "mean" },
];

// Icônes utilisées dans le panneau "Records de la station"
const RECORD_ICONS = {
  temperature_max: "mdi:thermometer-high",
  temperature_min: "mdi:thermometer-low",
  humidity_max: "mdi:water-percent",
  humidity_min: "mdi:water-percent-alert",
  wind_gust: "mdi:weather-windy-variant",
  rain_rate: "mdi:weather-pouring",
  uv_index: "mdi:sun-wireless",
};

/* ============================================================================
 * Utilitaires
 * ==========================================================================*/

function fmt(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number(value).toFixed(decimals);
}

function fmtDateShort(ts) {
  const d = new Date(ts);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Utilisé pour les records : les statistiques "day" n'ont pas d'heure
// exploitable (le champ start vaut toujours minuit), donc on n'affiche que
// la date.
function fmtDateOnly(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function windDirectionLabel(deg) {
  if (deg === null || deg === undefined || Number.isNaN(deg)) return "--";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  const idx = Math.round((deg % 360) / 22.5) % 16;
  return dirs[idx];
}

async function fetchStatistics(hass, statisticIds, startTime, endTime, period) {
  const ids = statisticIds.filter(Boolean);
  if (!ids.length) return {};
  try {
    return await hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: startTime,
      end_time: endTime,
      statistic_ids: ids,
      period,
      types: ["min", "max", "mean", "sum"],
    });
  } catch (err) {
    console.error(`${CARD_TAG}: échec de récupération des statistiques`, err);
    return {};
  }
}

/* ============================================================================
 * Rendu graphique (Canvas 2D, sans dépendance externe)
 * ==========================================================================*/

/**
 * Dessine un graphique simple (lignes et/ou barres) sur un canvas.
 * series: [{ label, color, points: [{t, v}], type: 'line'|'bar', axis: 'left'|'right', unit }]
 * options: { annotateExtremes: bool }
 */
function drawChart(canvas, series, options = {}) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(rect.width, 200);
  const height = options.height || 180;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const styles = getComputedStyle(canvas);
  const textColor = styles.getPropertyValue("--secondary-text-color").trim() || "#888";
  const gridColor = styles.getPropertyValue("--divider-color").trim() || "#e0e0e0";

  const padding = { top: 16, right: series.some((s) => s.axis === "right") ? 46 : 12, bottom: 22, left: 42 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const validSeries = series.filter((s) => s.points && s.points.length);
  if (!validSeries.length) {
    ctx.fillStyle = textColor;
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Pas de données pour cette période", width / 2, height / 2);
    CHART_DATA.set(canvas, { series: [] });
    return;
  }

  const allT = validSeries.flatMap((s) => s.points.map((p) => p.t));
  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const tSpan = Math.max(tMax - tMin, 1);

  function axisRange(axisName) {
    const relevant = validSeries.filter((s) => (s.axis || "left") === axisName);
    const pts = relevant.flatMap((s) => s.points.map((p) => p.v));
    relevant.forEach((s) => {
      if (s.extremes?.max) pts.push(s.extremes.max.v);
      if (s.extremes?.min) pts.push(s.extremes.min.v);
    });
    if (!pts.length) return null;
    let min = Math.min(...pts);
    let max = Math.max(...pts);

    // Pour un histogramme (barres) dont toutes les valeurs sont positives
    // ou nulles, la ligne de base doit être exactement 0 — sinon la marge
    // habituelle sous le minimum fait apparaître un petit reliquat de
    // barre même pour une valeur nulle.
    const allBars = relevant.length > 0 && relevant.every((s) => s.type === "bar");
    if (options.zeroBaseline && allBars && min >= 0) {
      min = 0;
      max = max > 0 ? max : 1;
      return { min: 0, max: max * 1.12 };
    }

    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.12;
    return { min: min - pad, max: max + pad };
  }

  const leftRange = axisRange("left");
  const rightRange = axisRange("right");

  function x(t) {
    return padding.left + ((t - tMin) / tSpan) * plotW;
  }
  function y(v, axis) {
    const r = axis === "right" ? rightRange : leftRange;
    return padding.top + plotH - ((v - r.min) / (r.max - r.min)) * plotH;
  }

  // Grille horizontale + graduations axe gauche
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = textColor;
  ctx.font = "10px sans-serif";
  const rows = 4;
  for (let i = 0; i <= rows; i++) {
    const yy = padding.top + (plotH / rows) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, yy);
    ctx.lineTo(width - padding.right, yy);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (leftRange) {
      const val = leftRange.max - ((leftRange.max - leftRange.min) / rows) * i;
      ctx.textAlign = "right";
      ctx.fillText(fmt(val, 0), padding.left - 6, yy + 3);
    }
    if (rightRange) {
      const val = rightRange.max - ((rightRange.max - rightRange.min) / rows) * i;
      ctx.textAlign = "left";
      ctx.fillText(fmt(val, 0), width - padding.right + 6, yy + 3);
    }
  }

  // Axe temps (3 repères)
  ctx.textAlign = "center";
  for (let i = 0; i <= 2; i++) {
    const t = tMin + (tSpan / 2) * i;
    ctx.fillText(fmtDateShort(t), x(t), height - 6);
  }

  // Tracé des séries
  validSeries.forEach((s) => {
    const axis = s.axis || "left";
    const opacity = s.opacity ?? 1;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.globalAlpha = opacity;

    if (s.type === "bar") {
      const bw = Math.max(plotW / s.points.length - 2, 1);
      s.points.forEach((p) => {
        if (!(p.v > 0)) return; // pas de barre pour une valeur nulle ou négative
        const px = x(p.t) - bw / 2;
        const py = y(p.v, axis);
        const baseY = padding.top + plotH;
        ctx.globalAlpha = opacity * 0.85;
        ctx.fillRect(px, py, bw, baseY - py);
        ctx.globalAlpha = opacity;
      });
    } else {
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const px = x(p.t);
        const py = y(p.v, axis);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }

    // Annotation min/max : utilise les vraies valeurs min/max des
    // statistiques HA si disponibles (s.extremes), plutôt que le min/max
    // de la courbe lissée (moyenne par intervalle), qui peut masquer un
    // pic bref survenu au sein d'un même intervalle.
    if (options.annotateExtremes && s.points.length > 1) {
      let minP;
      let maxP;
      if (s.extremes?.max && s.extremes?.min) {
        maxP = s.extremes.max;
        minP = s.extremes.min;
      } else {
        minP = s.points[0];
        maxP = s.points[0];
        s.points.forEach((p) => {
          if (p.v < minP.v) minP = p;
          if (p.v > maxP.v) maxP = p;
        });
      }
      [
        { p: maxP, sign: -1 },
        { p: minP, sign: 1 },
      ].forEach(({ p, sign }) => {
        const px = x(p.t);
        const py = y(p.v, axis);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "10px sans-serif";
        ctx.textAlign = px < padding.left + 30 ? "left" : px > width - padding.right - 30 ? "right" : "center";
        ctx.fillText(`${fmt(p.v)}${s.unit || ""}`, px, py + sign * 10 - (sign < 0 ? 2 : -10));
      });
    }
  });

  CHART_DATA.set(canvas, { series: validSeries, tMin, tMax, tSpan, padding, plotW, plotH });
}

/* ============================================================================
 * Boussole (direction instantanée du vent)
 * ==========================================================================*/

function drawCompass(canvas, degrees, size = 90) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 15;

  const styles = getComputedStyle(canvas);
  const textColor = styles.getPropertyValue("--secondary-text-color").trim() || "#888";
  const gridColor = styles.getPropertyValue("--divider-color").trim() || "#ccc";
  const accent = styles.getPropertyValue("--primary-color").trim() || "#03A9F4";

  // Cercle extérieur
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Graduations toutes les 30°
  for (let d = 0; d < 360; d += 30) {
    const a = (d * Math.PI) / 180 - Math.PI / 2;
    const inner = d % 90 === 0 ? r - 8 : r - 4;
    ctx.beginPath();
    ctx.moveTo(cx + inner * Math.cos(a), cy + inner * Math.sin(a));
    ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    ctx.stroke();
  }

  // Points cardinaux
  ctx.fillStyle = textColor;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelR = r + 10;
  [
    ["N", 0],
    ["E", 90],
    ["S", 180],
    ["O", 270],
  ].forEach(([lbl, deg]) => {
    const a = (deg * Math.PI) / 180 - Math.PI / 2;
    ctx.fillText(lbl, cx + labelR * Math.cos(a), cy + labelR * Math.sin(a));
  });

  // Aiguille pointant dans la direction vers laquelle souffle le vent
  // (wind_bearing indique traditionnellement l'origine du vent, on ajoute
  // donc 180° pour pointer vers la direction de destination)
  if (degrees !== null && degrees !== undefined && !Number.isNaN(degrees)) {
    const a = ((degrees + 180) * Math.PI) / 180 - Math.PI / 2;
    const tipX = cx + (r - 6) * Math.cos(a);
    const tipY = cy + (r - 6) * Math.sin(a);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    const headSize = 6;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headSize * Math.cos(a - 0.4), tipY - headSize * Math.sin(a - 0.4));
    ctx.lineTo(tipX - headSize * Math.cos(a + 0.4), tipY - headSize * Math.sin(a + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
}

/* ============================================================================
 * Rose des vents (répartition historique direction / force)
 * ==========================================================================*/

/**
 * Convertit une série cumulative qui se remet à zéro périodiquement (ex.
 * pluie du jour, compteur "total" qui repart à 0 à minuit) en barres de
 * quantité tombée PAR HEURE : différence entre valeurs cumulées
 * successives, avec repli sur la valeur brute quand une remise à zéro est
 * détectée (différence négative), puis regroupement par heure calendaire
 * (indépendamment de la granularité des points fournis en entrée).
 */
function buildHourlyDeltaBars(cumulativePoints) {
  if (!cumulativePoints.length) return [];
  const sorted = [...cumulativePoints].sort((a, b) => a.t - b.t);

  const deltas = sorted.map((p, i) => {
    const prev = i > 0 ? sorted[i - 1].v : 0;
    let d = p.v - prev;
    if (d < 0) d = p.v; // remise à zéro détectée entre ce point et le précédent
    return { t: p.t, v: Math.max(d, 0) };
  });

  const byHour = new Map();
  deltas.forEach((p) => {
    const hourStart = new Date(p.t);
    hourStart.setMinutes(0, 0, 0);
    const key = hourStart.getTime();
    byHour.set(key, (byHour.get(key) || 0) + p.v);
  });

  return [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
}

/**
 * Associe les échantillons de direction et de vitesse par timestamp et les
 * répartit en secteurs (direction) x classes de vitesse.
 */
function buildWindRoseData(dirPoints, speedPoints) {
  const speedByT = new Map(speedPoints.map((p) => [p.t, p.v]));
  const sectorSize = 360 / WIND_ROSE_SECTORS;
  const bins = Array.from({ length: WIND_ROSE_SECTORS }, () => new Array(WIND_ROSE_SPEED_BINS.length).fill(0));
  let total = 0;

  dirPoints.forEach((p) => {
    const spd = speedByT.get(p.t);
    if (spd === undefined || spd === null || p.v === null || p.v === undefined) return;
    const deg = ((p.v % 360) + 360) % 360;
    const sectorIdx = Math.round(deg / sectorSize) % WIND_ROSE_SECTORS;
    let speedIdx = WIND_ROSE_SPEED_BINS.findIndex((max) => spd <= max);
    if (speedIdx === -1) speedIdx = WIND_ROSE_SPEED_BINS.length - 1;
    bins[sectorIdx][speedIdx] += 1;
    total += 1;
  });

  return { bins, total };
}

function drawWindRose(canvas, roseData, baseColor) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const size = Math.max(Math.min(rect.width, 280), 200);

  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const styles = getComputedStyle(canvas);
  const textColor = styles.getPropertyValue("--secondary-text-color").trim() || "#888";
  const gridColor = styles.getPropertyValue("--divider-color").trim() || "#ddd";

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 26;

  const { bins, total } = roseData;
  if (!total) {
    ctx.fillStyle = textColor;
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Pas de données pour cette période", cx, cy);
    return;
  }

  const sectorTotals = bins.map((b) => b.reduce((a, c) => a + c, 0));
  const maxSectorFraction = Math.max(...sectorTotals) / total;

  // Cercles de repère (25/50/75/100 % de la valeur max)
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.font = "9px sans-serif";
  ctx.fillStyle = textColor;
  [0.25, 0.5, 0.75, 1].forEach((f) => {
    const r = maxR * f;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(maxSectorFraction * f * 100)}%`, cx + 3, cy - r + 9);
  });

  // Secteurs (empilement des classes de vitesse)
  const sectorAngle = (2 * Math.PI) / WIND_ROSE_SECTORS;
  bins.forEach((sectorBins, i) => {
    const angleCenter = i * sectorAngle - Math.PI / 2; // secteur 0 = Nord, en haut
    const startAngle = angleCenter - sectorAngle / 2 + 0.015;
    const endAngle = angleCenter + sectorAngle / 2 - 0.015;
    let cumulative = 0;
    sectorBins.forEach((count, si) => {
      if (!count) return;
      const fracBefore = cumulative / total;
      cumulative += count;
      const fracAfter = cumulative / total;
      const rInner = Math.min((fracBefore / maxSectorFraction) * maxR, maxR);
      const rOuter = Math.min((fracAfter / maxSectorFraction) * maxR, maxR);
      ctx.beginPath();
      ctx.moveTo(cx + rInner * Math.cos(startAngle), cy + rInner * Math.sin(startAngle));
      ctx.arc(cx, cy, rOuter, startAngle, endAngle);
      ctx.arc(cx, cy, rInner, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = baseColor;
      ctx.globalAlpha = WIND_ROSE_OPACITIES[si % WIND_ROSE_OPACITIES.length];
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  });

  // Points cardinaux
  ctx.fillStyle = textColor;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelR = maxR + 14;
  [
    ["N", 0],
    ["E", 90],
    ["S", 180],
    ["O", 270],
  ].forEach(([lbl, deg]) => {
    const a = (deg * Math.PI) / 180 - Math.PI / 2;
    ctx.fillText(lbl, cx + labelR * Math.cos(a), cy + labelR * Math.sin(a));
  });
}

/* ============================================================================
 * Mini-graphique (sparkline) pour la vue instantanée
 * ==========================================================================*/

function drawSparkline(canvas, points, color) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(rect.width, 60);
  const height = 40;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (!points || points.length < 2) return;

  const vals = points.map((p) => p.v);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.15;
  min -= pad;
  max += pad;

  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const tSpan = Math.max(tMax - tMin, 1);
  const x = (t) => ((t - tMin) / tSpan) * width;
  const y = (v) => height - ((v - min) / (max - min)) * height;

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, `${color}66`);
  grad.addColorStop(1, `${color}00`);

  ctx.beginPath();
  points.forEach((p, i) => {
    const px = x(p.t);
    const py = y(p.v);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => {
    const px = x(p.t);
    const py = y(p.v);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = "round";
  ctx.stroke();
}

class EcowittWs90Card extends HTMLElement {
  static getConfigElement() {
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig() {
    return {
      title: "Station météo WS90",
      entities: {
        temperature: "",
        humidity: "",
        wind_speed: "",
        wind_gust: "",
        wind_direction: "",
        rain_rate: "",
        rain_daily: "",
        solar_radiation: "",
        uv_index: "",
        pressure: "",
      },
      default_mode: "instant",
      default_period: "24h",
      show_records: true,
      show_mini_graphs: true,
      mini_graph_period: "24h",
    };
  }

  setConfig(config) {
    if (!config || !config.entities) {
      throw new Error("ecowitt-ws90-card : la clé 'entities' est requise dans la configuration");
    }
    this._config = {
      title: "Station météo",
      default_mode: "instant",
      default_period: "24h",
      show_records: true,
      show_mini_graphs: true,
      mini_graph_period: "24h",
      ...config,
      entities: { ...config.entities },
    };
    this._mode = this._config.default_mode === "historical" ? "historical" : "instant";
    this._period = PERIODS.some((p) => p.key === this._config.default_period) ? this._config.default_period : "24h";
    const todayIso = new Date().toISOString().slice(0, 10);
    const twoWeeksAgoIso = new Date(Date.now() - 13 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (!this._customStart) this._customStart = twoWeeksAgoIso;
    if (!this._customEnd) this._customEnd = todayIso;
    this._records = null;
    this._recordsLoading = false;
    this._miniGraphsLoading = false;
    this._miniGraphsLoadedFields = new Set();
    this._miniGraphsLastAttempt = 0;

    if (!this._root) {
      this._root = this.attachShadow({ mode: "open" });
      this._buildShell();
    }
    this._renderMode();
    this._maybeLoadRecords();
    this._loadMiniGraphs();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._mode === "instant") {
      this._renderInstantValues();
      this._loadMiniGraphs();
    }
    this._maybeLoadRecords();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return this._mode === "instant" ? 11 : 16;
  }

  connectedCallback() {
    if (this._config && this._root && !this._connected) {
      this._connected = true;
    }
    // La carte peut être détachée puis rattachée au DOM par Lovelace (ex.
    // réorganisation d'une mise en page en grille) : sans ce redémarrage,
    // le rafraîchissement périodique des mini-graphiques restait arrêté
    // indéfiniment après un tel détachement.
    if (this._config?.show_mini_graphs && this._mode === "instant" && !this._miniGraphInterval) {
      this._miniGraphsLoadedFields?.clear();
      this._miniGraphsLastAttempt = 0;
      this._loadMiniGraphs();
      this._startMiniGraphRefresh();
    }
  }

  disconnectedCallback() {
    this._stopMiniGraphRefresh();
  }

  _startMiniGraphRefresh() {
    this._stopMiniGraphRefresh();
    if (!this._config.show_mini_graphs) return;
    this._miniGraphInterval = setInterval(() => {
      // Rafraîchissement périodique : on ré-interroge tout, y compris les
      // métriques déjà chargées, pour garder les courbes à jour.
      this._miniGraphsLoadedFields.clear();
      this._miniGraphsLastAttempt = 0;
      this._loadMiniGraphs();
    }, 60 * 1000);
  }

  _stopMiniGraphRefresh() {
    if (this._miniGraphInterval) {
      clearInterval(this._miniGraphInterval);
      this._miniGraphInterval = null;
    }
  }

  async _loadMiniGraphs() {
    if (!this._hass || this._mode !== "instant" || !this._config.show_mini_graphs) return;
    if (this._miniGraphsLoading) return;

    const e = this._config.entities;
    // On ne redemande QUE les métriques pas encore chargées avec succès —
    // une métrique qui a des données ne bloque ni n'est bloquée par les
    // autres : chacune est suivie indépendamment.
    const tileFields = MINI_GRAPH_FIELDS.filter((f) => e[f.key] && !this._miniGraphsLoadedFields.has(f.key));
    const needsTH =
      (e.temperature && !this._miniGraphsLoadedFields.has("temperature")) ||
      (e.humidity && !this._miniGraphsLoadedFields.has("humidity"));
    if (!tileFields.length && !needsTH) return;

    // Tant qu'il reste des métriques sans données (capteur récemment
    // ajouté, historique pas encore constitué...), on retente
    // périodiquement plutôt que d'abandonner définitivement — mais on
    // limite la fréquence pour ne pas spammer l'API à chaque mise à jour
    // de hass.
    const now = Date.now();
    if (this._miniGraphsLastAttempt && now - this._miniGraphsLastAttempt < 30000) return;
    this._miniGraphsLastAttempt = now;
    this._miniGraphsLoading = true;

    const period = MINI_PERIODS.find((p) => p.key === this._config.mini_graph_period) || MINI_PERIODS[3];
    const end = new Date();
    const start = new Date(end.getTime() - period.hours * 3600 * 1000);
    const ids = tileFields.map((f) => e[f.key]);
    if (needsTH) {
      if (e.temperature) ids.push(e.temperature);
      if (e.humidity) ids.push(e.humidity);
    }
    let stats = {};
    try {
      stats = await fetchStatistics(this._hass, ids, start.toISOString(), end.toISOString(), period.statPeriod);
    } finally {
      this._miniGraphsLoading = false;
    }

    tileFields.forEach((f) => {
      const canvas = this._root.getElementById(`spark-${f.key}`);
      if (!canvas) return;
      const rows = stats[e[f.key]] || [];
      const points = rows
        .map((row) => ({ t: new Date(row.start).getTime(), v: row[f.agg] }))
        .filter((p) => p.v !== null && p.v !== undefined);
      if (points.length) this._miniGraphsLoadedFields.add(f.key);
      requestAnimationFrame(() => drawSparkline(canvas, points, this._themeColor(THEME_COLOR)));
    });

    if (needsTH) this._drawTempHumidityChart(stats);
  }

  _drawTempHumidityChart(stats) {
    const e = this._config.entities;
    const canvas = this._root.getElementById("chart-th-instant");
    if (!canvas) return;

    const pointsFor = (entityId) =>
      (stats[entityId] || [])
        .map((row) => ({ t: new Date(row.start).getTime(), v: row.mean }))
        .filter((p) => p.v !== null && p.v !== undefined);

    const tempPoints = e.temperature ? pointsFor(e.temperature) : [];
    const humPoints = e.humidity ? pointsFor(e.humidity) : [];
    if (tempPoints.length) this._miniGraphsLoadedFields.add("temperature");
    if (humPoints.length) this._miniGraphsLoadedFields.add("humidity");

    const baseColor = this._themeColor(THEME_COLOR);
    const series = [];
    if (e.temperature) series.push({ label: "Température", color: baseColor, points: tempPoints, unit: "°C", axis: "left" });
    if (e.humidity) {
      series.push({
        label: "Humidité",
        color: baseColor,
        opacity: e.temperature ? 0.5 : 1,
        points: humPoints,
        unit: "%",
        axis: e.temperature ? "right" : "left",
      });
    }

    const legend = this._root.getElementById("legend-th");
    if (legend) {
      legend.innerHTML = series
        .map((s) => `<span><span class="dot" style="background:${s.color};opacity:${s.opacity ?? 1}"></span>${s.label}</span>`)
        .join("");
    }
    requestAnimationFrame(() => drawChart(canvas, series, { annotateExtremes: true, height: 150 }));
  }

  /* ---- structure statique ---- */

  _buildShell() {
    this._root.innerHTML = `
      <style>${this._css()}</style>
      <ha-card>
        <div class="header">
          <div class="title"></div>
          <div class="mode-toggle">
            <button data-mode="instant" class="mode-btn">Instantané</button>
            <button data-mode="historical" class="mode-btn">Historique</button>
          </div>
        </div>
        <div class="body"></div>
      </ha-card>
      <div class="chart-tooltip" id="chart-tooltip"></div>
    `;
    this._root.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._mode = btn.dataset.mode;
        this._renderMode();
      });
    });
  }

  _css() {
    return `
      :host {
        --ecowitt-color: var(--primary-color, #03A9F4);
      }
      ha-card { padding: 16px; }
      .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
      .title { font-size: 1.2rem; font-weight: 500; color: var(--primary-text-color); }
      .mode-toggle { display: flex; border-radius: 8px; overflow: hidden; border: 1px solid var(--divider-color); }
      .mode-btn { border: none; background: var(--card-background-color); color: var(--primary-text-color); padding: 6px 12px; font-size: 0.85rem; cursor: pointer; }
      .mode-btn.active { background: var(--primary-color); color: var(--text-primary-color, #fff); }
      .period-row { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
      .period-btn { border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); padding: 4px 10px; border-radius: 14px; font-size: 0.8rem; cursor: pointer; }
      .period-btn.active { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
      .custom-range-row { display: flex; align-items: center; gap: 8px; margin: -4px 0 14px; flex-wrap: wrap; }
      .custom-range-row input[type="date"] { border: 1px solid var(--divider-color); border-radius: 6px; background: var(--card-background-color); color: var(--primary-text-color); padding: 4px 6px; font-size: 0.8rem; }
      .custom-range-row .range-sep { color: var(--secondary-text-color); font-size: 0.8rem; }
      .apply-btn { border: none; background: var(--primary-color); color: var(--text-primary-color, #fff); border-radius: 6px; padding: 5px 12px; font-size: 0.8rem; cursor: pointer; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-bottom: 14px; }
      .stat { background: var(--secondary-background-color, rgba(127,127,127,0.08)); border: 1px solid var(--divider-color); border-radius: 10px; padding: 10px; text-align: center; box-sizing: border-box; }
      .stat .value { font-size: 1.25rem; font-weight: 600; color: var(--primary-text-color); }
      .stat .label { font-size: 0.72rem; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .03em; }
      .stat .sub { font-size: 0.72rem; color: var(--secondary-text-color); margin-top: 2px; }
      .stat-graph { text-align: left; overflow: hidden; }
      .stat-graph .stat-top { display: flex; align-items: flex-start; justify-content: space-between; }
      .stat-graph .stat-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); opacity: 0.6; }
      .stat-graph .value { margin-top: 2px; }
      .stat-graph .sparkline { margin-top: 6px; margin-left: -10px; margin-right: -10px; margin-bottom: -10px; width: calc(100% + 20px) !important; }
      .section-title { font-size: 0.95rem; font-weight: 500; color: var(--primary-text-color); margin: 10px 0 4px; }
      .chart-block { margin-bottom: 18px; border: 1px solid var(--divider-color); border-radius: 10px; padding: 10px; box-sizing: border-box; }
      .chart-tooltip { position: fixed; display: none; pointer-events: none; z-index: 9999; background: var(--card-background-color); color: var(--primary-text-color); border: 1px solid var(--divider-color); border-radius: 6px; padding: 5px 8px; font-size: 0.72rem; line-height: 1.4; box-shadow: 0 2px 8px rgba(0,0,0,0.3); white-space: nowrap; }
      .chart-tooltip .tt-date { color: var(--secondary-text-color); font-size: 0.68rem; margin-bottom: 2px; }
      .chart-legend { display: flex; gap: 12px; font-size: 0.75rem; color: var(--secondary-text-color); margin-bottom: 4px; }
      .chart-legend span { display: inline-flex; align-items: center; gap: 4px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      canvas { width: 100%; display: block; }
      .compass-stat { display: flex; flex-direction: column; align-items: center; }
      .compass-canvas { width: 90px !important; height: 90px; margin: 4px 0; }
      .compass-value { font-size: 0.85rem !important; }
      .th-section { margin-bottom: 18px; border: 1px solid var(--divider-color); border-radius: 10px; padding: 12px; box-sizing: border-box; }
      .th-header { display: flex; gap: 24px; margin-bottom: 8px; flex-wrap: wrap; }
      .th-value { display: flex; align-items: center; gap: 6px; }
      .th-value .th-icon { --mdc-icon-size: 22px; color: var(--secondary-text-color); opacity: 0.7; }
      .th-value .value { font-size: 1.7rem; font-weight: 600; color: var(--primary-text-color); }
      .th-canvas { height: 150px; }
      .wind-section { display: flex; align-items: center; gap: 16px; border: 1px solid var(--divider-color); border-radius: 10px; padding: 12px; box-sizing: border-box; margin-bottom: 18px; flex-wrap: wrap; }
      .compass-canvas-lg { width: 110px !important; height: 110px; flex-shrink: 0; }
      .wind-info { display: flex; flex-direction: column; gap: 6px; }
      .wind-speed-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .wind-speed-row .value { font-size: 1.6rem; font-weight: 600; color: var(--primary-text-color); }
      .wind-dir { font-size: 0.85rem; color: var(--secondary-text-color); }
      .wind-gust-row { font-size: 0.85rem; color: var(--secondary-text-color); }
      .wind-gust-row .value { font-weight: 600; color: var(--primary-text-color); }
      .windrose-wrap { display: flex; flex-direction: column; align-items: center; }
      .windrose-canvas { width: 100%; max-width: 280px; }
      .windrose-legend { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; font-size: 0.72rem; color: var(--secondary-text-color); margin-top: 6px; }
      .records-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
      .record { background: var(--secondary-background-color, rgba(127,127,127,0.08)); border: 1px solid var(--divider-color); border-radius: 10px; padding: 8px 10px; box-sizing: border-box; }
      .record-top { display: flex; align-items: flex-start; justify-content: space-between; }
      .record-icon { --mdc-icon-size: 18px; opacity: 0.75; }
      .record .label { font-size: 0.72rem; color: var(--secondary-text-color); }
      .record .value { font-size: 1rem; font-weight: 600; color: var(--primary-text-color); }
      .record .date { font-size: 0.68rem; color: var(--secondary-text-color); }
      .empty { color: var(--secondary-text-color); font-size: 0.85rem; padding: 8px 0; }
    `;
  }

  /* ---- rendu selon le mode ---- */

  _renderMode() {
    this._root.querySelector(".title").textContent = this._config.title;
    this._root.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === this._mode));

    const body = this._root.querySelector(".body");
    if (this._mode === "instant") {
      body.innerHTML = this._instantSkeleton();
      this._renderInstantValues();
      this._renderRecords();
      // Les canvases sont recréés à chaque entrée dans la vue instantanée :
      // on force donc un nouveau tracé pour toutes les métriques, même
      // celles déjà chargées précédemment (les anciens canvases n'existent
      // plus).
      this._miniGraphsLoadedFields.clear();
      this._miniGraphsLastAttempt = 0;
      this._loadMiniGraphs();
      this._startMiniGraphRefresh();
    } else {
      this._stopMiniGraphRefresh();
      body.innerHTML = this._historicalSkeleton();
      this._root.querySelectorAll(".period-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.period === this._period);
        btn.addEventListener("click", () => {
          this._period = btn.dataset.period;
          this._renderMode();
        });
      });
      const applyBtn = this._root.getElementById("custom-apply");
      if (applyBtn) {
        applyBtn.addEventListener("click", () => {
          const startInput = this._root.getElementById("custom-start");
          const endInput = this._root.getElementById("custom-end");
          if (!startInput.value || !endInput.value) return;
          this._customStart = startInput.value;
          this._customEnd = endInput.value;
          this._loadAndRenderHistorical();
        });
      }
      this._loadAndRenderHistorical();
      ["chart-temperature", "chart-humidity", "chart-wind", "chart-rain", "chart-sun", "chart-pressure"].forEach((id) => this._attachTooltip(id));
    }
  }

  _attachTooltip(canvasId) {
    const canvas = this._root.getElementById(canvasId);
    const tooltip = this._root.getElementById("chart-tooltip");
    if (!canvas || !tooltip) return;

    const hide = () => {
      tooltip.style.display = "none";
    };

    canvas.addEventListener("mousemove", (evt) => {
      const data = CHART_DATA.get(canvas);
      if (!data || !data.series.length) {
        hide();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const relX = evt.clientX - rect.left - data.padding.left;
      if (relX < 0 || relX > data.plotW) {
        hide();
        return;
      }
      const t = data.tMin + (relX / data.plotW) * data.tSpan;

      let nearestT = null;
      const lines = [];
      data.series.forEach((s) => {
        if (!s.points.length) return;
        let nearest = s.points[0];
        let bestDiff = Math.abs(nearest.t - t);
        for (const p of s.points) {
          const diff = Math.abs(p.t - t);
          if (diff < bestDiff) {
            bestDiff = diff;
            nearest = p;
          }
        }
        if (nearestT === null) nearestT = nearest.t;
        lines.push(`<div>${s.label} : <strong>${fmt(nearest.v)}${s.unit || ""}</strong></div>`);
      });
      if (!lines.length) {
        hide();
        return;
      }

      tooltip.innerHTML = `<div class="tt-date">${fmtDateShort(nearestT)}</div>${lines.join("")}`;
      tooltip.style.display = "block";

      // Évite que l'infobulle ne sorte de l'écran sur les bords
      const ttWidth = tooltip.offsetWidth || 120;
      let left = evt.clientX + 14;
      if (left + ttWidth > window.innerWidth) left = evt.clientX - ttWidth - 14;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${evt.clientY + 14}px`;
    });

    canvas.addEventListener("mouseleave", hide);
  }

  _instantSkeleton() {
    const e = this._config.entities;
    const showMini = this._config.show_mini_graphs;
    const statWithGraph = (key, label) => {
      const field = MINI_GRAPH_FIELDS.find((f) => f.key === key);
      const showGraph = showMini && field && e[key];
      return `
        <div class="stat${showGraph ? " stat-graph" : ""}" id="s-${key}">
          <div class="stat-top">
            <div class="label">${label}</div>
            ${field ? `<ha-icon icon="${field.icon}" class="stat-icon"></ha-icon>` : ""}
          </div>
          <div class="value">--</div>
          ${showGraph ? `<canvas class="sparkline" id="spark-${key}"></canvas>` : ""}
        </div>`;
    };

    const hasTH = e.temperature || e.humidity;
    const hasWind = e.wind_speed || e.wind_gust || e.wind_direction;
    const hasSun = e.solar_radiation || e.uv_index;
    const hasRain = e.rain_rate || e.rain_daily;

    return `
      ${hasTH ? this._tempHumiditySection() : ""}
      ${hasWind ? this._windSection() : ""}
      ${hasSun ? `<div class="section-title">Luminosité &amp; UV</div><div class="grid">
        ${e.solar_radiation ? statWithGraph("solar_radiation", "Luminosité") : ""}
        ${e.uv_index ? statWithGraph("uv_index", "Index UV") : ""}
      </div>` : ""}
      ${hasRain ? `<div class="section-title">Pluie</div><div class="grid">
        ${e.rain_rate ? `<div class="stat" id="s-rain_rate"><div class="label">Intensité</div><div class="value">--</div></div>` : ""}
        ${e.rain_daily ? `<div class="stat" id="s-rain_daily"><div class="label">Cumul du jour</div><div class="value">--</div></div>` : ""}
      </div>` : ""}
      ${e.pressure ? `<div class="section-title">Pression</div><div class="grid">${statWithGraph("pressure", "Pression")}</div>` : ""}
      ${this._config.show_records ? `<div class="section-title">Records de la station</div><div class="records-grid" id="records-container"><div class="empty">Chargement…</div></div>` : ""}
    `;
  }

  _tempHumiditySection() {
    const e = this._config.entities;
    return `
      <div class="th-section">
        <div class="th-header">
          ${e.temperature ? `<div class="th-value" id="s-temperature"><ha-icon icon="mdi:thermometer" class="th-icon"></ha-icon><span class="value">--</span></div>` : ""}
          ${e.humidity ? `<div class="th-value" id="s-humidity"><ha-icon icon="mdi:water-percent" class="th-icon"></ha-icon><span class="value">--</span></div>` : ""}
        </div>
        <div class="chart-legend" id="legend-th"></div>
        <canvas id="chart-th-instant" class="th-canvas"></canvas>
      </div>
    `;
  }

  _windSection() {
    const e = this._config.entities;
    return `
      <div class="section-title">Vent</div>
      <div class="wind-section">
        ${e.wind_direction ? `<canvas class="compass-canvas-lg" id="compass-canvas"></canvas>` : ""}
        <div class="wind-info">
          ${e.wind_speed ? `<div class="wind-speed-row"><span class="value" id="s-wind_speed">--</span>${e.wind_direction ? `<span class="wind-dir" id="s-wind_direction">--</span>` : ""}</div>` : ""}
          ${e.wind_gust ? `<div class="wind-gust-row">Rafale <span class="value" id="s-wind_gust">--</span></div>` : ""}
        </div>
      </div>
    `;
  }

  _historicalSkeleton() {
    const e = this._config.entities;
    const periodButtons = PERIODS.map((p) => `<button class="period-btn" data-period="${p.key}">${p.label}</button>`).join("");
    const isCustom = this._period === "custom";
    return `
      <div class="period-row">
        ${periodButtons}
        <button class="period-btn" data-period="custom">Personnalisé</button>
      </div>
      <div class="custom-range-row" id="custom-range-row" style="${isCustom ? "" : "display:none"}">
        <input type="date" id="custom-start" value="${this._customStart || ""}" />
        <span class="range-sep">→</span>
        <input type="date" id="custom-end" value="${this._customEnd || ""}" />
        <button class="apply-btn" id="custom-apply">Appliquer</button>
      </div>
      ${e.temperature ? this._chartBlock("temperature", "Température", "°C") : ""}
      ${e.humidity ? this._chartBlock("humidity", "Humidité", "%") : ""}
      ${e.wind_speed || e.wind_gust ? this._chartBlock("wind", "Vent (vitesse & rafales)", "km/h") : ""}
      ${e.wind_direction && e.wind_speed ? this._windRoseBlock() : ""}
      ${e.rain_rate || e.rain_daily ? this._chartBlock("rain", "Pluie", "mm") : ""}
      ${e.solar_radiation || e.uv_index ? this._chartBlock("sun", "Luminosité & Index UV", "") : ""}
      ${e.pressure ? this._chartBlock("pressure", "Pression atmosphérique", "hPa") : ""}
    `;
  }

  _chartBlock(id, title, unit) {
    return `
      <div class="chart-block">
        <div class="section-title">${title}${unit ? ` (${unit})` : ""}</div>
        <div class="chart-legend" id="legend-${id}"></div>
        <canvas id="chart-${id}"></canvas>
      </div>
    `;
  }

  _windRoseBlock() {
    const legend = WIND_ROSE_SPEED_LABELS.map(
      (lbl, i) => `<span><span class="dot" style="background:${this._themeColor(THEME_COLOR)};opacity:${WIND_ROSE_OPACITIES[i]}"></span>${lbl}</span>`
    ).join("");
    return `
      <div class="chart-block windrose-wrap">
        <div class="section-title">Rose des vents</div>
        <canvas class="windrose-canvas" id="chart-windrose"></canvas>
        <div class="windrose-legend">${legend}</div>
      </div>
    `;
  }

  /* ---- instantané ---- */

  _renderInstantValues() {
    if (!this._hass || this._mode !== "instant") return;
    const e = this._config.entities;
    const set = (id, html) => {
      const el = this._root.getElementById(`s-${id}`);
      if (el) el.querySelector(".value").innerHTML = html;
    };

    if (e.temperature) set("temperature", `${fmt(this._stateNum(e.temperature))} °C`);
    if (e.humidity) set("humidity", `${fmt(this._stateNum(e.humidity), 0)} %`);
    if (e.wind_speed) {
      const el = this._root.getElementById("s-wind_speed");
      if (el) el.textContent = `${fmt(this._stateNum(e.wind_speed))} km/h`;
    }
    if (e.wind_gust) {
      const el = this._root.getElementById("s-wind_gust");
      if (el) el.textContent = `${fmt(this._stateNum(e.wind_gust))} km/h`;
    }
    if (e.wind_direction) {
      const deg = this._stateNum(e.wind_direction);
      const canvas = this._root.getElementById("compass-canvas");
      if (canvas) drawCompass(canvas, deg, 110);
      const dirEl = this._root.getElementById("s-wind_direction");
      if (dirEl) dirEl.textContent = deg === null ? "" : `Vent de ${windDirectionLabel(deg)} (${fmt(deg, 0)}°)`;
    }
    if (e.rain_rate) set("rain_rate", `${fmt(this._stateNum(e.rain_rate))} mm/h`);
    if (e.rain_daily) set("rain_daily", `${fmt(this._stateNum(e.rain_daily))} mm`);
    if (e.solar_radiation) set("solar_radiation", `${fmt(this._stateNum(e.solar_radiation), 0)} W/m²`);
    if (e.uv_index) set("uv_index", `${fmt(this._stateNum(e.uv_index), 1)}`);
    if (e.pressure) set("pressure", `${fmt(this._stateNum(e.pressure), 1)} hPa`);
  }

  _stateNum(entityId) {
    const st = this._hass?.states?.[entityId];
    if (!st) return null;
    const v = parseFloat(st.state);
    return Number.isNaN(v) ? null : v;
  }

  _themeColor(colorVar) {
    const v = getComputedStyle(this).getPropertyValue(colorVar.css).trim();
    return v || colorVar.fallback;
  }

  /* ---- records (long-term statistics, toute la période disponible) ---- */

  async _maybeLoadRecords() {
    if (!this._hass || !this._config.show_records || this._recordsLoading || this._records !== null) return;
    this._recordsLoading = true;

    const e = this._config.entities;
    const recordSpecs = [
      { key: "temperature", entity: e.temperature, label: "Température max", agg: "max", unit: "°C", icon: RECORD_ICONS.temperature_max },
      { key: "temperature", entity: e.temperature, label: "Température min", agg: "min", unit: "°C", icon: RECORD_ICONS.temperature_min },
      { key: "humidity", entity: e.humidity, label: "Humidité max", agg: "max", unit: "%", icon: RECORD_ICONS.humidity_max },
      { key: "humidity", entity: e.humidity, label: "Humidité min", agg: "min", unit: "%", icon: RECORD_ICONS.humidity_min },
      { key: "wind_gust", entity: e.wind_gust, label: "Rafale max", agg: "max", unit: "km/h", icon: RECORD_ICONS.wind_gust },
      { key: "rain_rate", entity: e.rain_rate, label: "Intensité pluie max", agg: "max", unit: "mm/h", icon: RECORD_ICONS.rain_rate },
      { key: "uv_index", entity: e.uv_index, label: "Index UV max", agg: "max", unit: "", icon: RECORD_ICONS.uv_index },
    ].filter((r) => r.entity);

    const ids = [...new Set(recordSpecs.map((r) => r.entity))];
    const start = new Date(0).toISOString();
    const end = new Date().toISOString();
    const stats = await fetchStatistics(this._hass, ids, start, end, "day");

    const records = recordSpecs.map((r) => {
      const rows = stats[r.entity] || [];
      if (!rows.length) return { ...r, value: null, date: null };
      let best = rows[0];
      rows.forEach((row) => {
        const bestVal = best[r.agg];
        const rowVal = row[r.agg];
        if (rowVal === null || rowVal === undefined) return;
        if (bestVal === null || bestVal === undefined) {
          best = row;
        } else if (r.agg === "max" ? rowVal > bestVal : rowVal < bestVal) {
          best = row;
        }
      });
      return { ...r, value: best[r.agg], date: best.start };
    });

    this._records = records;
    this._recordsLoading = false;
    this._renderRecords();
  }

  _renderRecords() {
    if (!this._config.show_records || this._mode !== "instant") return;
    const container = this._root.getElementById("records-container");
    if (!container) return;
    if (!this._records) {
      container.innerHTML = `<div class="empty">Chargement…</div>`;
      return;
    }
    if (!this._records.length) {
      container.innerHTML = `<div class="empty">Aucune entité configurée pour les records</div>`;
      return;
    }
    container.innerHTML = this._records
      .map((r) => {
        const color = this._themeColor(THEME_COLOR);
        return `
        <div class="record">
          <div class="record-top">
            <div class="label">${r.label}</div>
            ${r.icon ? `<ha-icon icon="${r.icon}" class="record-icon" style="color:${color}"></ha-icon>` : ""}
          </div>
          <div class="value">${r.value === null ? "--" : `${fmt(r.value, r.unit === "%" ? 0 : 1)} ${r.unit}`}</div>
          <div class="date">${r.date ? fmtDateOnly(r.date) : ""}</div>
        </div>`;
      })
      .join("");
  }

  /* ---- historique / graphiques ---- */

  async _loadAndRenderHistorical() {
    if (!this._hass) return;
    const e = this._config.entities;

    let start;
    let end;
    let statPeriod;
    if (this._period === "custom" && this._customStart && this._customEnd) {
      start = new Date(`${this._customStart}T00:00:00`);
      end = new Date(`${this._customEnd}T23:59:59`);
      if (end < start) [start, end] = [end, start];
      const spanHours = (end - start) / 3600000;
      // Aligné sur le comportement natif de Home Assistant : la résolution
      // horaire est conservée bien au-delà de quelques semaines (jusqu'à
      // plusieurs années) avant de basculer sur une moyenne journalière.
      statPeriod = spanHours <= 48 ? "5minute" : spanHours <= 24 * 730 ? "hour" : "day";
    } else {
      const period = PERIODS.find((p) => p.key === this._period) || PERIODS[0];
      end = new Date();
      start = new Date(end.getTime() - period.hours * 3600 * 1000);
      statPeriod = period.statPeriod;
    }

    const ids = Object.values(e).filter(Boolean);
    const stats = await fetchStatistics(this._hass, ids, start.toISOString(), end.toISOString(), statPeriod);

    const seriesFor = (entityId, agg = "mean") =>
      (stats[entityId] || [])
        .map((row) => ({ t: new Date(row.start).getTime(), v: row[agg] }))
        .filter((p) => p.v !== null && p.v !== undefined);

    // Comme seriesFor, mais essaie plusieurs champs dans l'ordre : certains
    // capteurs (compteurs cumulatifs qui se remettent à zéro, ex. pluie du
    // jour, state_class "total") n'ont QUE la statistique "sum" de
    // calculée par Home Assistant — pas de "max"/"mean"/"min". Sans ce
    // repli, seriesFor(entity, "max") ne renvoie jamais aucun point pour
    // ce type de capteur, même quand l'historique existe bel et bien.
    const seriesForAny = (entityId, aggs) =>
      (stats[entityId] || [])
        .map((row) => {
          let v;
          for (const agg of aggs) {
            if (row[agg] !== null && row[agg] !== undefined) {
              v = row[agg];
              break;
            }
          }
          return { t: new Date(row.start).getTime(), v };
        })
        .filter((p) => p.v !== null && p.v !== undefined);

    // Idem pour les vraies valeurs min/max annotées : repli sur "sum" si
    // "max"/"min" ne sont pas disponibles pour ce type de capteur.
    const extremesForAny = (entityId, maxAggs, minAggs) => {
      const rows = stats[entityId] || [];
      const pick = (row, aggs) => {
        for (const agg of aggs) {
          if (row[agg] !== null && row[agg] !== undefined) return row[agg];
        }
        return undefined;
      };
      let maxRow = null;
      let maxVal;
      let minRow = null;
      let minVal;
      rows.forEach((row) => {
        const mv = pick(row, maxAggs);
        if (mv !== undefined && (!maxRow || mv > maxVal)) {
          maxRow = row;
          maxVal = mv;
        }
        const nv = pick(row, minAggs);
        if (nv !== undefined && (!minRow || nv < minVal)) {
          minRow = row;
          minVal = nv;
        }
      });
      return {
        max: maxRow ? { t: new Date(maxRow.start).getTime(), v: maxVal } : null,
        min: minRow ? { t: new Date(minRow.start).getTime(), v: minVal } : null,
      };
    };

    // Vraies valeurs min/max des statistiques HA (indépendantes de la
    // courbe moyenne affichée), pour annoter le pic/creux réel plutôt que
    // celui de la moyenne lissée par intervalle.
    const extremesFor = (entityId) => {
      const rows = stats[entityId] || [];
      let maxRow = null;
      let minRow = null;
      rows.forEach((row) => {
        if (row.max !== null && row.max !== undefined && (!maxRow || row.max > maxRow.max)) maxRow = row;
        if (row.min !== null && row.min !== undefined && (!minRow || row.min < minRow.min)) minRow = row;
      });
      return {
        max: maxRow ? { t: new Date(maxRow.start).getTime(), v: maxRow.max } : null,
        min: minRow ? { t: new Date(minRow.start).getTime(), v: minRow.min } : null,
      };
    };

    const baseColor = this._themeColor(THEME_COLOR);

    if (e.temperature) {
      this._drawWithLegend("temperature", [
        { label: "Température", color: baseColor, points: seriesFor(e.temperature), unit: "°C", extremes: extremesFor(e.temperature) },
      ], { annotateExtremes: true });
    }
    if (e.humidity) {
      this._drawWithLegend("humidity", [
        { label: "Humidité", color: baseColor, points: seriesFor(e.humidity), unit: "%", extremes: extremesFor(e.humidity) },
      ], { annotateExtremes: true });
    }
    if (e.wind_speed || e.wind_gust) {
      const s = [];
      if (e.wind_speed) s.push({ label: "Vitesse", color: baseColor, points: seriesFor(e.wind_speed), unit: " km/h", extremes: extremesFor(e.wind_speed) });
      if (e.wind_gust) s.push({ label: "Rafales", color: baseColor, opacity: 0.5, points: seriesFor(e.wind_gust, "max"), unit: " km/h", extremes: extremesFor(e.wind_gust) });
      this._drawWithLegend("wind", s, { annotateExtremes: true });
    }
    if (e.wind_direction && e.wind_speed) {
      const roseCanvas = this._root.getElementById("chart-windrose");
      if (roseCanvas) {
        const dirPoints = seriesFor(e.wind_direction);
        const speedPoints = seriesFor(e.wind_speed);
        const roseData = buildWindRoseData(dirPoints, speedPoints);
        requestAnimationFrame(() => drawWindRose(roseCanvas, roseData, baseColor));
      }
    }
    if (e.rain_rate || e.rain_daily) {
      const s = [];
      if (e.rain_daily) {
        const cumulative = seriesForAny(e.rain_daily, ["max", "sum", "mean", "state"]);
        s.push({ label: "Pluie horaire", color: baseColor, points: buildHourlyDeltaBars(cumulative), type: "bar", unit: " mm" });
      }
      if (e.rain_rate) {
        s.push({
          label: "Intensité",
          color: baseColor,
          opacity: e.rain_daily ? 0.6 : 1,
          points: seriesForAny(e.rain_rate, ["max", "mean", "sum"]),
          unit: " mm/h",
          axis: e.rain_daily ? "right" : "left",
          extremes: extremesForAny(e.rain_rate, ["max"], ["min"]),
        });
      }
      this._drawWithLegend("rain", s, { annotateExtremes: true, zeroBaseline: true });
    }
    if (e.solar_radiation || e.uv_index) {
      const s = [];
      if (e.solar_radiation) s.push({ label: "Luminosité", color: baseColor, points: seriesFor(e.solar_radiation), unit: " W/m²", axis: "left", extremes: extremesFor(e.solar_radiation) });
      if (e.uv_index) s.push({ label: "UV", color: baseColor, opacity: 0.5, points: seriesFor(e.uv_index, "max"), unit: "", axis: e.solar_radiation ? "right" : "left", extremes: extremesFor(e.uv_index) });
      this._drawWithLegend("sun", s, { annotateExtremes: true });
    }
    if (e.pressure) {
      this._drawWithLegend("pressure", [
        { label: "Pression", color: baseColor, points: seriesFor(e.pressure), unit: " hPa", extremes: extremesFor(e.pressure) },
      ], { annotateExtremes: true });
    }
  }

  _drawWithLegend(id, series, options) {
    const canvas = this._root.getElementById(`chart-${id}`);
    const legend = this._root.getElementById(`legend-${id}`);
    if (!canvas) return;
    if (legend) {
      legend.innerHTML = series
        .map((s) => `<span><span class="dot" style="background:${s.color};opacity:${s.opacity ?? 1}"></span>${s.label}</span>`)
        .join("");
    }
    // Attendre que le canvas ait une largeur avant de dessiner
    requestAnimationFrame(() => drawChart(canvas, series, options));
  }
}

/* ============================================================================
 * Editeur de configuration (visuel, dans l'éditeur de tableau de bord HA)
 * ==========================================================================*/

class EcowittWs90CardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...EcowittWs90Card.getStubConfig(), ...config, entities: { ...EcowittWs90Card.getStubConfig().entities, ...(config.entities || {}) } };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._root?.querySelectorAll("ha-entity-picker").forEach((picker) => {
      picker.hass = hass;
    });
  }

  _emitChange() {
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _render() {
    if (!this._root) {
      this._root = this.attachChildren ? this : this.attachShadow({ mode: "open" });
    }
    const c = this._config;
    this._root.innerHTML = `
      <style>
        .row { margin-bottom: 10px; }
        .row label { display: block; font-size: 0.8rem; color: var(--secondary-text-color); margin-bottom: 2px; }
        input[type="text"], select { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        fieldset { border: 1px solid var(--divider-color); border-radius: 8px; margin: 12px 0; }
        legend { padding: 0 6px; color: var(--secondary-text-color); font-size: 0.8rem; }
        .checkbox-row { display: flex; align-items: center; gap: 8px; }
      </style>
      <div class="row">
        <label>Titre de la carte</label>
        <input type="text" id="title" value="${c.title || ""}" />
      </div>
      <div class="grid2">
        <div class="row">
          <label>Mode par défaut</label>
          <select id="default_mode">
            <option value="instant" ${c.default_mode === "instant" ? "selected" : ""}>Instantané</option>
            <option value="historical" ${c.default_mode === "historical" ? "selected" : ""}>Historique</option>
          </select>
        </div>
        <div class="row">
          <label>Période par défaut</label>
          <select id="default_period">
            ${PERIODS.map((p) => `<option value="${p.key}" ${c.default_period === p.key ? "selected" : ""}>${p.label}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="row checkbox-row">
        <input type="checkbox" id="show_records" ${c.show_records ? "checked" : ""} />
        <label style="margin:0">Afficher les records de la station</label>
      </div>
      <div class="row checkbox-row">
        <input type="checkbox" id="show_mini_graphs" ${c.show_mini_graphs ? "checked" : ""} />
        <label style="margin:0">Afficher des mini-graphiques sous température / humidité / vent / rafales (vue instantanée)</label>
      </div>
      <div class="row" id="mini_graph_period_row" style="${c.show_mini_graphs ? "" : "display:none"}">
        <label>Durée des mini-graphiques</label>
        <select id="mini_graph_period">
          ${MINI_PERIODS.map((p) => `<option value="${p.key}" ${c.mini_graph_period === p.key ? "selected" : ""}>${p.label}</option>`).join("")}
        </select>
      </div>
      <fieldset>
        <legend>Entités Ecowitt</legend>
        ${ENTITY_FIELDS.map(
          (f) => `
          <div class="row">
            <label>${f.label}</label>
            <ha-entity-picker id="ent-${f.key}" data-key="${f.key}" allow-custom-entity></ha-entity-picker>
          </div>`
        ).join("")}
      </fieldset>
    `;

    this._root.getElementById("title").addEventListener("input", (ev) => {
      this._config.title = ev.target.value;
      this._emitChange();
    });
    this._root.getElementById("default_mode").addEventListener("change", (ev) => {
      this._config.default_mode = ev.target.value;
      this._emitChange();
    });
    this._root.getElementById("default_period").addEventListener("change", (ev) => {
      this._config.default_period = ev.target.value;
      this._emitChange();
    });
    this._root.getElementById("show_records").addEventListener("change", (ev) => {
      this._config.show_records = ev.target.checked;
      this._emitChange();
    });
    this._root.getElementById("show_mini_graphs").addEventListener("change", (ev) => {
      this._config.show_mini_graphs = ev.target.checked;
      this._root.getElementById("mini_graph_period_row").style.display = ev.target.checked ? "" : "none";
      this._emitChange();
    });
    this._root.getElementById("mini_graph_period").addEventListener("change", (ev) => {
      this._config.mini_graph_period = ev.target.value;
      this._emitChange();
    });

    this._root.querySelectorAll("ha-entity-picker").forEach((picker) => {
      const key = picker.dataset.key;
      picker.hass = this._hass;
      picker.value = this._config.entities[key] || "";
      picker.addEventListener("value-changed", (ev) => {
        this._config.entities[key] = ev.detail.value;
        this._emitChange();
      });
    });
  }
}

/* ============================================================================
 * Enregistrement des custom elements
 * ==========================================================================*/

if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, EcowittWs90Card);
if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, EcowittWs90CardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: "Ecowitt WS90 Card",
  description: "Carte dédiée à une station météo Ecowitt WS90 : valeurs instantanées, graphiques historiques (période sélectionnable) et records de la station.",
});