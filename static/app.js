const $ = (selector) => document.querySelector(selector);
const video = $("#video");
const overlay = $("#overlay");
const capture = document.createElement("canvas");
const captureContext = capture.getContext("2d", { willReadFrequently: true });

const emotions = {
  neutral: { model: "neutral", label: "Neutral", emoji: "😌", caption: "Rostro relajado o sin señales marcadas", message: "Una expresión tranquila también comunica. <b>Una pausa puede ser un buen momento para respirar.</b>" },
  happy: { model: "happy", label: "Alegría", emoji: "😊", caption: "Señales asociadas a una sonrisa", message: "¡Se detectan señales de alegría! <b>Ojalá encuentres algo que te siga sacando una sonrisa.</b>" },
  sad: { model: "sad", label: "Tristeza", emoji: "🌧️", caption: "Señales faciales asociadas a tristeza", message: "El modelo observa señales que suelen asociarse con tristeza. <b>Si necesitas un momento, está bien tomártelo.</b>" },
  angry: { model: "angry", label: "Enojo", emoji: "🌋", caption: "Señales faciales de tensión", message: "El rostro muestra señales que el modelo asocia con enojo. <b>Tomar aire despacio puede ayudarte a hacer una pausa.</b>" },
  fearful: { model: "fear", label: "Temor", emoji: "🌱", caption: "Señales faciales asociadas a temor", message: "Hay señales que el modelo asocia con temor. <b>Si te ayuda, haz una pausa y nota lo que necesitas en este momento.</b>" },
  disgusted: { model: "disgust", label: "Desagrado", emoji: "🍋", caption: "Señales faciales de desagrado", message: "Se observan señales que suelen asociarse con desagrado. <b>Escuchar lo que necesitas puede ser un buen primer paso.</b>" },
  surprised: { model: "surprise", label: "Sorpresa", emoji: "✨", caption: "Señales faciales de sorpresa", message: "¡El modelo detecta señales de sorpresa! <b>A veces lo inesperado abre una nueva posibilidad.</b>" },
};
const keys = Object.keys(emotions);
const emotionList = $("#emotionList");
emotionList.innerHTML = keys.map((key) => `
  <div class="emotion-row" data-key="${key}" style="display: grid; grid-template-columns: 24px 1fr 38px; gap: 10px; align-items: center; padding: 6px 0; font-size: 11.5px;">
    <span>${emotions[key].emoji}</span>
    <span class="mini" style="display: block; height: 4px; background: var(--border-color); border-radius: 3px; overflow: hidden;"><i style="display: block; width: 0%; height: 100%; background: var(--text-muted); transition: width 0.3s;"></i></span>
    <span class="pct" style="text-align: right; font: 700 10px 'DM Mono', monospace;">0%</span>
  </div>
`).join("");

let stream = null;
let running = false;
let busy = false;
let smoothed = {};

// Variables para el análisis estadístico de sesión y registros faciales
let isAnalyzingSession = false;
let sessionSamples = [];
let sessionStartedAt = 0;
let sessionTimerInterval = null;
let facialLogs = [];

// Variable global para la sensibilidad ajustable por el usuario (por defecto 0.50 o 50%)
let minConfidenceThreshold = 0.50;

function setStatus(label, active) {
  $("#liveLabel").textContent = label;
  $("#liveDot").style.background = active ? "var(--green)" : "#66756c";
  $("#liveDot").style.boxShadow = active ? "0 0 12px #c6f27670" : "none";
}

function toast(text) {
  const element = $("#toast");
  element.textContent = text;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 3600);
}

function updateRow(key, value, active) {
  const row = document.querySelector(`[data-key="${key}"]`);
  if (!row) return;
  row.classList.toggle("active", active);
  row.querySelector(".mini i").style.width = `${Math.round(value * 100)}%`;
  row.querySelector(".pct").textContent = `${Math.round(value * 100)}%`;
}

function showExpression(key) {
  keys.forEach((item) => updateRow(item, smoothed[item] || 0, item === key));
  const confidence = smoothed[key] || 0;
  
  if (confidence < minConfidenceThreshold) {
    $("#mainEmotion").textContent = "Poco concluyente";
    $("#mainCaption").textContent = "Por debajo del umbral de sensibilidad";
    $("#mainEmoji").textContent = "🔎";
    $("#message").innerHTML = "<b>La estimación está filtrada.</b> Baja la sensibilidad o mejora la iluminación.";
    $("#confidenceTag").textContent = "BAJA SEÑAL";
  } else {
    const item = emotions[key];
    $("#mainEmotion").textContent = item.label;
    $("#mainCaption").textContent = item.caption;
    $("#mainEmoji").textContent = item.emoji;
    $("#message").innerHTML = item.message;
    $("#confidenceTag").textContent = `${Math.round(confidence * 100)}%`;
  }
  $("#confidenceValue").textContent = `${Math.round(confidence * 100)}%`;
  $("#confidenceBar").style.width = `${Math.round(confidence * 100)}%`;
}

function clearOverlay() {
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
}

// Funciones para gestionar el Historial de Registros Faciales
function addFacialLog(emotionLabel, emoji, confidence) {
  const now = new Date();
  const timeString = now.toLocaleTimeString();
  
  const logEntry = {
    time: timeString,
    text: `${emoji} Se detectó <b>${emotionLabel}</b> con un <b>${Math.round(confidence * 100)}%</b> de confianza.`
  };

  facialLogs.unshift(logEntry);
  if (facialLogs.length > 15) facialLogs.pop();

  renderFacialLogs();
  
  const timelineSummary = $("#timelineCurrentSummary");
  if (timelineSummary) {
    timelineSummary.textContent = `${emoji} ${emotionLabel} (${Math.round(confidence * 100)}%) - ${timeString}`;
  }
}

function renderFacialLogs() {
  const container = $("#facialLogsContainer");
  if (!container) return;

  if (facialLogs.length === 0) {
    container.innerHTML = `<div style="font-style: italic; opacity: 0.7;">Aún no hay registros en esta sesión. Inicia la cámara...</div>`;
    return;
  }

  container.innerHTML = facialLogs.map(log => `
    <div style="background: rgba(255,255,255,0.03); padding: 6px 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; border-left: 2px solid var(--green);">
      <span>${log.text}</span>
      <span style="font-size: 9px; opacity: 0.6; font-family: 'DM Mono', monospace; margin-left: 8px; white-space: nowrap;">${log.time}</span>
    </div>
  `).join("");
}

async function analyzeFrame() {
  if (!running || busy || video.readyState < 2) return;
  busy = true;
  try {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const ratio = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
    capture.width = Math.round(sourceWidth * ratio);
    capture.height = Math.round(sourceHeight * ratio);
    captureContext.drawImage(video, 0, 0, capture.width, capture.height);
    const image = capture.toDataURL("image/jpeg", 0.72);
    const response = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo analizar el fotograma.");

    if (overlay.width !== sourceWidth || overlay.height !== sourceHeight) {
      overlay.width = sourceWidth;
      overlay.height = sourceHeight;
    }
    clearOverlay();

    if (!result.faces.length) {
      keys.forEach((key) => { smoothed[key] = 0; updateRow(key, 0, false); });
      $("#mainEmotion").textContent = "No detectado";
      $("#mainCaption").textContent = "Coloca tu rostro frente a la cámara";
      $("#mainEmoji").textContent = "👀";
      $("#message").innerHTML = "<b>No vemos un rostro con claridad.</b> Ajusta la posición o mejora la iluminación.";
      $("#confidenceTag").textContent = "—";
      $("#confidenceValue").textContent = "—";
      $("#confidenceBar").style.width = "0";
      return;
    }

    const face = result.faces[0];
    const [x, y, width, height] = face.box;
    const scaleX = sourceWidth / result.width;
    const scaleY = sourceHeight / result.height;
    const context = overlay.getContext("2d");
    context.strokeStyle = "#c6f276";
    context.lineWidth = Math.max(2, sourceWidth / 480);
    context.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);

    keys.forEach((key) => {
      const raw = Number(face.expressions[emotions[key].model] || 0);
      smoothed[key] = (smoothed[key] ?? raw) * 0.58 + raw * 0.42;
    });

    if (isAnalyzingSession) {
      let currentFrameData = {};
      keys.forEach((key) => {
        currentFrameData[key] = smoothed[key] || 0;
      });
      currentFrameData._second = (Date.now() - sessionStartedAt) / 1000;
      sessionSamples.push(currentFrameData);
    }

    const winner = keys.reduce((best, key) => smoothed[key] > smoothed[best] ? key : best);
    showExpression(winner);

    const currentConf = smoothed[winner] || 0;
    if (currentConf >= minConfidenceThreshold) {
      const lastLog = facialLogs[0];
      const nowText = new Date().toLocaleTimeString();
      if (!lastLog || lastLog.time !== nowText) {
        addFacialLog(emotions[winner].label, emotions[winner].emoji, currentConf);
      }
    }

  } catch (error) {
    console.error(error);
    if (running) toast(error.message || "Error al analizar la cámara.");
  } finally {
    busy = false;
    if (running) setTimeout(analyzeFrame, 650);
  }
}

async function startCamera() {
  if (running) return;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("La cámara requiere un navegador compatible y acceso local a esta página.");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    $("#placeholder").hidden = true;
    $("#startBtn").disabled = true;
    $("#stopBtn").disabled = false;
    $("#captureBtn").disabled = false;
    setStatus("EN VIVO", true);
    analyzeFrame();
  } catch (error) {
    console.error(error);
    toast(error.name === "NotAllowedError" ? "Permite el acceso a la cámara en tu navegador." : error.message || "No fue posible iniciar la cámara.");
    setStatus("EN ESPERA", false);
  }
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  clearOverlay();
  $("#placeholder").hidden = false;
  $("#startBtn").disabled = false;
  $("#stopBtn").disabled = true;
  $("#captureBtn").disabled = true;
  setStatus("EN ESPERA", false);
  $("#mainEmotion").textContent = "En espera";
  $("#mainCaption").textContent = "Activa la cámara para comenzar";
  $("#mainEmoji").textContent = "✳️";
  $("#message").innerHTML = "<b>Todo listo.</b> Cuando quieras, inicia la cámara para explorar una estimación de las expresiones visibles.";
  $("#confidenceTag").textContent = "—";
  $("#confidenceValue").textContent = "—";
  $("#confidenceBar").style.width = "0";
  smoothed = {};
  keys.forEach((key) => updateRow(key, 0, false));
  
  if (isAnalyzingSession) {
    isAnalyzingSession = false;
    clearInterval(sessionTimerInterval);
    $("#sessionProgressContainer").style.display = "none";
    $("#startSessionAnalysisBtn").disabled = false;
  }
}

// Lógica de Análisis Estadístico de Sesión (15 segundos)
function startSessionAnalysis() {
  if (!running) {
    toast("Primero debes iniciar la cámara.");
    return;
  }
  if (isAnalyzingSession) return;

  isAnalyzingSession = true;
  sessionSamples = [];
  sessionStartedAt = Date.now();
  const charts = $("#sessionCharts");
  if (charts) charts.style.display = "none";

  const btn = $("#startSessionAnalysisBtn");
  btn.disabled = true;
  
  const progressContainer = $("#sessionProgressContainer");
  const resultCard = $("#sessionResultCard");
  const timerLabel = $("#sessionTimer");
  const bar = $("#sessionBar");
  const statusText = $("#sessionStatusText");

  if (progressContainer) progressContainer.style.display = "block";
  if (resultCard) resultCard.style.display = "none";
  if (bar) {
    bar.style.transition = "width 1s linear";
    bar.style.width = "100%";
  }

  let timeLeft = 15;
  if (timerLabel) timerLabel.textContent = `${timeLeft}s`;
  if (statusText) statusText.textContent = "Muestreando fotogramas de IA...";

  sessionTimerInterval = setInterval(() => {
    timeLeft--;
    if (timerLabel) timerLabel.textContent = `${timeLeft}s`;
    if (bar) bar.style.width = `${(timeLeft / 15) * 100}%`;

    if (timeLeft <= 0) {
      clearInterval(sessionTimerInterval);
      isAnalyzingSession = false;
      if (progressContainer) progressContainer.style.display = "none";
      btn.disabled = false;
      processSessionStatistics();
    }
  }, 1000);
}

function processSessionStatistics() {
  const resultCard = $("#sessionResultCard");
  const reportText = $("#sessionReportText");

  if (sessionSamples.length === 0) {
    if (resultCard) resultCard.style.display = "block";
    if (reportText) reportText.innerHTML = "<b>Aviso:</b> No se recolectaron suficientes muestras. Asegúrate de que el rostro esté visible frente a la cámara.";
    renderBasicStatistics();
    return;
  }

  let averages = {};
  keys.forEach((key) => {
    let sum = sessionSamples.reduce((acc, sample) => acc + (sample[key] || 0), 0);
    averages[key] = sum / sessionSamples.length;
  });

  let dominantKey = keys.reduce((best, key) => averages[key] > averages[best] ? key : best);
  let dominantInfo = emotions[dominantKey];

  let positiveScore = ((averages["happy"] || 0) * 1.0 + (averages["neutral"] || 0) * 0.6 - (averages["angry"] || 0) * 0.8 - (averages["sad"] || 0) * 0.8);
  let positivityPct = Math.max(0, Math.min(100, Math.round((positiveScore + 0.3) * 100)));

  let varianceSum = 0;
  sessionSamples.forEach((sample) => {
    let diff = (sample[dominantKey] || 0) - averages[dominantKey];
    varianceSum += diff * diff;
  });
  let variance = varianceSum / sessionSamples.length;
  let stabilityLabel = "Alta estabilidad (Enfoque sostenido)";
  if (variance > 0.04) stabilityLabel = "Dinámica / Expresiva (Variación frecuente)";
  else if (variance > 0.015) stabilityLabel = "Moderada (Fluctuación normal)";

  let sortedEmotions = keys.map(k => ({ key: k, val: averages[k] })).sort((a, b) => b.val - a.val);
  let secondaryEmo = sortedEmotions[1] ? emotions[sortedEmotions[1].key] : null;

  let regSamples = sessionSamples.map((sample, index) => ({
    x: index + 1,
    y: sample[dominantKey] || 0
  }));

  let nSamples = regSamples.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  regSamples.forEach(p => {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  });

  let slope = 0;
  let intercept = nSamples > 0 ? sumY / nSamples : 0;
  let denominator = (nSamples * sumX2 - sumX * sumX);
  if (denominator !== 0) {
    slope = (nSamples * sumXY - sumX * sumY) / denominator;
    intercept = (sumY - slope * sumX) / nSamples;
  }

  let trendDescription = "Estable ⚖️";
  let trendColor = "var(--green)";
  if (slope > 0.003) {
    trendDescription = "En aumento 📈 (Tendencia positiva)";
  } else if (slope < -0.003) {
    trendDescription = "En descenso 📉 (Tendencia negativa)";
    trendColor = "var(--amber)";
  }

  let predictedValue = Math.max(0, Math.min(100, (slope * (nSamples + 10) + intercept) * 100)).toFixed(1);

  if (reportText) {
    reportText.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
        <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 6px;">
          🎯 <b>Predominante:</b><br><span style="font-size: 14px;">${dominantInfo.emoji} ${dominantInfo.label} (${Math.round(averages[dominantKey] * 100)}%)</span>
        </div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 6px;">
          📈 <b>Índice Bienestar:</b><br><span style="font-size: 14px;">✨ ${positivityPct}%</span>
        </div>
      </div>
      <div style="margin-bottom: 6px;">⚖️ <b>Patrón de Estabilidad:</b> ${stabilityLabel}</div>
      ${secondaryEmo ? `<div style="margin-bottom: 6px;">🔍 <b>Segunda expresión notable:</b> ${secondaryEmo.emoji} ${secondaryEmo.label} (${Math.round(averages[sortedEmotions[1].key] * 100)}%)</div>` : ''}
      
      <div style="margin-top: 10px; padding: 10px; background: rgba(198,242,118,0.05); border: 1px solid rgba(198,242,118,0.2); border-radius: 8px;">
        <div style="font-weight: bold; color: var(--green); margin-bottom: 4px;">📊 Regresión Lineal (Tendencia Temporal)</div>
        <div style="font-size: 11px;">Pendiente (m): ${slope.toFixed(4)}</div>
        <div style="font-size: 11px;">Tendencia: <span style="color: ${trendColor};">${trendDescription}</span></div>
        <div style="font-size: 11px;">Proyección estimada: ${predictedValue}% de intensidad</div>
      </div>

      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); color: var(--muted); font-size: 11px;">
        📌 <b>Muestras analizadas:</b> ${sessionSamples.length} fotogramas procesados localmente en 15 segundos.
      </div>
    `;
  }
  if (resultCard) resultCard.style.display = "block";
  toast("¡Reporte estadístico y regresión lineal generados con éxito!");
  renderBasicStatistics();
}

function renderBasicStatistics() {
  const container = $("#basicStatsOutput");
  if (!container) return;
  const n = sessionSamples.length;
  if (!n) {
    const charts = $("#sessionCharts");
    if (charts) charts.style.display = "none";
    container.textContent = "No hay fotogramas válidos. Activa la cámara, mantén el rostro visible e inicia otra sesión.";
    return;
  }

  const threshold = minConfidenceThreshold;
  const format = value => (value * 100).toFixed(2) + "%";
  const rows = keys.map(key => {
    const values = sessionSamples.map(sample => Number(sample[key]) || 0).sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / n;
    const middle = Math.floor(n / 2);
    const median = n % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);
    const cumulative = values.filter(value => value <= threshold).length / n;
    const above = values.filter(value => value > threshold).length / n;
    return { key, mean, median, variance, stdDev, cumulative, above };
  });
  const top = rows.reduce((best, row) => row.mean > best.mean ? row : best);
  renderSessionCharts(rows);

  container.innerHTML = `
    <div style="margin-bottom: 10px; color: var(--white);">
      <b>${n}</b> fotogramas válidos · Mayor media: <b>${emotions[top.key].label}</b> (${format(top.mean)})
    </div>
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; text-align: right; white-space: nowrap; font-size: 10px;">
        <thead><tr style="color: var(--green); border-bottom: 1px solid #ffffff26;">
          <th style="padding: 8px 6px; text-align:left;">Expresión</th>
          <th style="padding: 8px 6px;">Media</th><th style="padding: 8px 6px;">Mediana</th>
          <th style="padding: 8px 6px;">Varianza</th><th style="padding: 8px 6px;">Desv. est.</th>
          <th style="padding: 8px 6px;">P acum.</th><th style="padding: 8px 6px;">Supera umbral</th>
        </tr></thead>
        <tbody>${rows.map(row => `<tr style="border-bottom: 1px solid #ffffff12; color: var(--white);">
          <td style="padding: 8px 6px; text-align:left;">${emotions[row.key].emoji} ${emotions[row.key].label}</td>
          <td style="padding: 8px 6px;">${format(row.mean)}</td>
          <td style="padding: 8px 6px;">${format(row.median)}</td>
          <td style="padding: 8px 6px;">${row.variance.toFixed(4)}</td>
          <td style="padding: 8px 6px;">${row.stdDev.toFixed(4)}</td>
          <td style="padding: 8px 6px;">${format(row.cumulative)}</td>
          <td style="padding: 8px 6px;">${format(row.above)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
    <p style="font-size: 10px; color: var(--muted); margin: 12px 0 0; line-height: 1.6;">
      Umbral: <b>${format(threshold)}</b>. P acumulada = P(puntuación ≤ umbral); supera umbral = P(puntuación > umbral).
    </p>`;
}

function prepareStatCanvas(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const w = Math.max(240, Math.round(canvas.getBoundingClientRect().width || 320));
  const h = Number.parseInt(canvas.style.height, 10) || 220;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * pixelRatio);
  canvas.height = Math.round(h * pixelRatio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "10px sans-serif";
  return { ctx, w, h };
}

function renderSessionCharts(rows) {
  const section = document.getElementById("sessionCharts");
  if (!section || !sessionSamples.length) return;
  section.style.display = "block";
  const ordered = [...rows].sort((a, b) => b.mean - a.mean);
  const colors = ["#c6f276", "#65c9cf", "#e6b66e", "#bba7ec", "#e78f96", "#90b2fd", "#f3c2dd"];

  const bar = prepareStatCanvas("meanEmotionChart");
  if (bar) {
    const { ctx, w, h } = bar;
    const left = 76, right = 40, top = 16, bottom = 27;
    const graphWidth = Math.max(50, w - left - right);
    const rowHeight = (h - top - bottom) / ordered.length;
    ctx.textBaseline = "middle";
    [0, 0.25, 0.5, 0.75, 1].forEach(t => {
      const x = left + t * graphWidth;
      ctx.strokeStyle = "#ffffff19";
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, h - bottom + 2); ctx.stroke();
      ctx.fillStyle = "#9baaa3";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round(t * 100)}%`, x, h - 10);
    });
    ordered.forEach((row, i) => {
      const cy = top + (i + 0.5) * rowHeight;
      ctx.fillStyle = "#dce8df";
      ctx.textAlign = "right";
      ctx.fillText(emotions[row.key].label, left - 8, cy);
      ctx.fillStyle = colors[i];
      ctx.fillRect(left, cy - 7, Math.max(0, Math.min(1, row.mean)) * graphWidth, 14);
      ctx.textAlign = "left";
      ctx.fillStyle = "#e6f5de";
      ctx.fillText(`${(row.mean * 100).toFixed(1)}%`, Math.min(w - 35, left + row.mean * graphWidth + 4), cy);
    });
  }

  const line = prepareStatCanvas("emotionEvolutionChart");
  const selected = ordered.slice(0, 2);
  if (line) {
    const { ctx, w, h } = line;
    const left = 39, right = 10, top = 14, bottom = 29;
    const gw = w - left - right, gh = h - top - bottom;
    ctx.textBaseline = "middle";
    [0, 0.25, 0.5, 0.75, 1].forEach(t => {
      const y = top + (1 - t) * gh;
      ctx.strokeStyle = "#ffffff20";
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
      ctx.fillStyle = "#9baaa3";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(t * 100)}%`, left - 5, y);
    });
    [0, 5, 10, 15].forEach(s => {
      const x = left + (s / 15) * gw;
      ctx.textAlign = "center";
      ctx.fillStyle = "#9baaa3";
      ctx.fillText(`${s}s`, x, h - 12);
    });
    selected.forEach((row, i) => {
      ctx.beginPath();
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 2;
      sessionSamples.forEach((sample, index) => {
        const second = Number.isFinite(sample._second) ? sample._second : (index / Math.max(1, sessionSamples.length - 1)) * 15;
        const x = left + Math.max(0, Math.min(15, second)) / 15 * gw;
        const y = top + (1 - Math.max(0, Math.min(1, Number(sample[row.key]) || 0))) * gh;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }
  const legend = document.getElementById("emotionChartLegend");
  if (legend) legend.innerHTML = selected.map((row, i) =>
    `<span><span style="color:${colors[i]};font-size:14px;">●</span> ${emotions[row.key].label}</span>`
  ).join("");
}

const captureBtn = $("#captureBtn");
const captureModal = $("#captureModal");
const closeModalBtn = $("#closeModalBtn");
const modalFace = $("#modalFace");
const modalEmoji = $("#modalEmoji");
const modalEmotion = $("#modalEmotion");
const modalConfidence = $("#modalConfidence");
const modalEmotionList = $("#modalEmotionList");
const modalMessage = $("#modalMessage");
const celebrityResult = $("#celebrityResult");

async function compareCapturedFace(imageData) {
  if (!celebrityResult) return;
  celebrityResult.textContent = "Comparando con las fotos disponibles… Un momento.";
  try {
    const response = await fetch("/api/celebrity/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageData }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "No se pudo comparar.");
    
    celebrityResult.replaceChildren();
    const [best, ...others] = result.matches || [];
    if (!best) {
      celebrityResult.textContent = "No hay coincidencias en la galería.";
      return;
    }

    // Contenedor principal con foto y datos del parecido
    const winnerBox = document.createElement("div");
    winnerBox.style.cssText = "display: flex; align-items: center; gap: 12px; margin-bottom: 8px;";

    if (best.image) {
      const img = document.createElement("img");
      img.src = best.image;
      img.alt = best.name;
      img.style.cssText = "width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 2.5px solid var(--brown-primary); flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.15);";
      winnerBox.appendChild(img);
    }

    const infoDiv = document.createElement("div");
    
    const headline = document.createElement("div");
    headline.style.cssText = "font: 800 13.5px Manrope, sans-serif; color: var(--text-main);";
    headline.textContent = `Se parece a ${best.name}`;

    const score = document.createElement("div");
    score.style.cssText = "font: 700 11px 'DM Mono', monospace; color: var(--brown-primary); margin-top: 2px;";
    score.textContent = `Similitud numérica: ${best.similarity}/100`;

    infoDiv.append(headline, score);
    winnerBox.appendChild(infoDiv);
    celebrityResult.appendChild(winnerBox);

    if (others.length) {
      const otherNames = document.createElement("div");
      otherNames.style.cssText = "margin-top: 6px; color: var(--text-muted); font-size: 10.5px;";
      otherNames.textContent = `Otras referencias cercanas: ${others.map((item) => `${item.name} (${item.similarity})`).join(", ")}.`;
      celebrityResult.appendChild(otherNames);
    }
  } catch (error) {
    celebrityResult.textContent = error.message || "No se pudo completar la comparación. Revisa que la carpeta de fotos de famosos exista en Flask.";
  }
}

if (captureBtn && captureModal) {
  captureBtn.addEventListener("click", () => {
    if (!running) {
      toast("Inicia la cámara primero para capturar.");
      return;
    }

    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 480;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = sourceWidth;
    tempCanvas.height = sourceHeight;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(video, 0, 0, sourceWidth, sourceHeight);
    modalFace.src = tempCanvas.toDataURL("image/jpeg", 0.9);

    const compareCanvas = document.createElement("canvas");
    const compareScale = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
    compareCanvas.width = Math.max(1, Math.round(sourceWidth * compareScale));
    compareCanvas.height = Math.max(1, Math.round(sourceHeight * compareScale));
    compareCanvas.getContext("2d").drawImage(video, 0, 0, compareCanvas.width, compareCanvas.height);
    const comparisonImage = compareCanvas.toDataURL("image/jpeg", 0.78);

    let dominantKey = keys[0];
    keys.forEach((key) => {
      if ((smoothed[key] || 0) > (smoothed[dominantKey] || 0)) {
        dominantKey = key;
      }
    });

    const dominantData = emotions[dominantKey];
    const confVal = smoothed[dominantKey] || 0;

    modalEmoji.textContent = dominantData.emoji;
    modalEmotion.textContent = dominantData.label;
    modalConfidence.textContent = `Confianza del modelo: ${Math.round(confVal * 100)}%`;
    modalMessage.innerHTML = dominantData.message;
    
    if (modalEmotionList) {
      modalEmotionList.innerHTML = keys.map((key) => {
        const item = emotions[key];
        const valPct = Math.round((smoothed[key] || 0) * 100);
        const isActive = key === dominantKey ? "active" : "";
        return `
          <div class="emotion-row ${isActive}" style="display: grid; grid-template-columns: 24px 1fr 38px; gap: 10px; align-items: center; padding: 4px 0; font-size: 11.5px;">
            <span>${item.emoji}</span>
            <div class="mini" style="height: 4px; background: var(--border-color); border-radius: 3px; overflow: hidden;"><i style="display: block; width: ${valPct}%; height: 100%; background: ${key === dominantKey ? 'var(--brown-primary)' : 'var(--text-muted)'};"></i></div>
            <span class="pct" style="text-align: right; font: 700 10px 'DM Mono', monospace;">${valPct}%</span>
          </div>
        `;
      }).join("");
    }

    if (typeof captureModal.showModal === "function") {
      captureModal.showModal();
    } else {
      captureModal.setAttribute("open", "true");
    }
    compareCapturedFace(comparisonImage);
  });
}

if (closeModalBtn && captureModal) {
  closeModalBtn.addEventListener("click", () => {
    captureModal.close();
  });

  captureModal.addEventListener("click", (e) => {
    const rect = captureModal.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      captureModal.close();
    }
  });
}

document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "clearLogsBtn") {
    facialLogs = [];
    renderFacialLogs();
    toast("Registros limpios.");
  }
  
  if (e.target.closest && e.target.closest("#timelineCardTrigger")) {
    if (facialLogs.length > 0) {
      toast(`Último registro activo: ${facialLogs[0].text.replace(/<[^>]*>/g, '')}`);
    } else {
      toast("Inicia la cámara para registrar transiciones en vivo.");
    }
  }
});

const sensitivityRange = $("#sensitivityRange");
if (sensitivityRange) {
  sensitivityRange.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    minConfidenceThreshold = val / 100;
    const valLabel = $("#sensitivityValueLabel");
    if (valLabel) valLabel.textContent = `${val}%`;
  });
}

$("#startBtn").addEventListener("click", startCamera);
$("#stopBtn").addEventListener("click", stopCamera);
const sessionBtn = $("#startSessionAnalysisBtn");
if (sessionBtn) sessionBtn.addEventListener("click", startSessionAnalysis);

window.addEventListener("pagehide", () => {
  if (stream) stream.getTracks().forEach((track) => track.stop());
});
