const $ = (selector) => document.querySelector(selector);
const video = $("#video");
const overlay = $("#overlay");
const capture = document.createElement("canvas");
const captureContext = capture.getContext("2d", { willReadFrequently: true });

const emotions = {
  neutral: { model: "neutral", label: "Neutral", emoji: "😌", caption: "Rostro relajado o sin señales marcadas", message: "Una expresión tranquila también comunica. <b>Una pausa puede ser un buen momento para respirar.</b>" },
  happy: { model: "happy", label: "Alegría", emoji: "😊", caption: "Señales asociadas a una sonrisa", message: "¡Se detectan señales de alegría! <b>Ojalá encuentres algo que te siga sacando una sonrisa.</b>" },
  sad: { model: "sad", label: "Tristeza", emoji: "🌧️", caption: "Señales faciales asociadas à tristeza", message: "El modelo observa señales que suelen asociarse con tristeza. <b>Si necesitas un momento, está bien tomártelo.</b>" },
  angry: { model: "angry", label: "Enojo", emoji: "🌋", caption: "Señales faciales de tensión", message: "El rostro muestra señales que el modelo asocia con enojo. <b>Tomar aire despacio puede ayudarte a hacer una pausa.</b>" },
  fearful: { model: "fear", label: "Temor", emoji: "🌱", caption: "Señales faciales asociadas a temor", message: "Hay señales que el modelo asocia con temor. <b>Si te ayuda, haz una pausa y nota lo que necesitas en este momento.</b>" },
  disgusted: { model: "disgust", label: "Desagrado", emoji: "🍋", caption: "Señales faciales de desagrado", message: "Se observan señales que suelen asociarse con desagrado. <b>Escuchar lo que necesitas puede ser un buen primer paso.</b>" },
  surprised: { model: "surprise", label: "Sorpresa", emoji: "✨", caption: "Señales faciales de sorpresa", message: "¡El modelo detecta señales de sorpresa! <b>A veces lo inesperado abre una nueva posibilidad.</b>" },
};
const keys = Object.keys(emotions);
const emotionList = $("#emotionList");
emotionList.innerHTML = keys.map((key) => `<div class="emotion-row" data-key="${key}"><span>${emotions[key].emoji}</span><span class="mini"><i></i></span><span class="pct">0%</span></div>`).join("");

let stream = null;
let running = false;
let busy = false;
let smoothed = {};

// Variables para el análisis estadístico de sesión y registros faciales
let isAnalyzingSession = false;
let sessionSamples = [];
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
  
  // Aplicar el umbral de sensibilidad configurado por el usuario
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
  
  // Actualizar también el panel interactivo de Transición Emocional en vivo
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
      sessionSamples.push(currentFrameData);
    }

    const winner = keys.reduce((best, key) => smoothed[key] > smoothed[best] ? key : best);
    showExpression(winner);

    // Registrar en el historial si la confianza supera el umbral dinámico actual
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
      video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    $("#placeholder").hidden = true;
    $("#startBtn").disabled = true;
    $("#stopBtn").disabled = false;
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
  setStatus("EN ESPERA", false);
  $("#mainEmotion").textContent = "En espera";
  $("#mainCaption").textContent = "Activa la cámara para comenzar";
  $("#mainEmoji").textContent = "✳";
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
  const btn = $("#startSessionAnalysisBtn");
  btn.disabled = true;
  
  const progressContainer = $("#sessionProgressContainer");
  const resultCard = $("#sessionResultCard");
  const timerLabel = $("#sessionTimer");
  const bar = $("#sessionBar");
  const statusText = $("#sessionStatusText");

  progressContainer.style.display = "block";
  resultCard.style.display = "none";
  bar.style.transition = "width 1s linear";
  bar.style.width = "100%";

  let timeLeft = 15;
  timerLabel.textContent = `${timeLeft}s`;
  statusText.textContent = "Muestreando fotogramas de IA...";

  sessionTimerInterval = setInterval(() => {
    timeLeft--;
    timerLabel.textContent = `${timeLeft}s`;
    bar.style.width = `${(timeLeft / 15) * 100}%`;

    if (timeLeft <= 0) {
      clearInterval(sessionTimerInterval);
      isAnalyzingSession = false;
      progressContainer.style.display = "none";
      btn.disabled = false;
      processSessionStatistics();
    }
  }, 1000);
}

function processSessionStatistics() {
  const resultCard = $("#sessionResultCard");
  const reportText = $("#sessionReportText");

  if (sessionSamples.length === 0) {
    resultCard.style.display = "block";
    reportText.innerHTML = "<b>Aviso:</b> No se recolectaron suficientes muestras. Asegúrate de que el rostro esté visible frente a la cámara.";
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
    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); color: var(--muted); font-size: 11px;">
      📌 <b>Muestras analizadas:</b> ${sessionSamples.length} fotogramas procesados localmente en 15 segundos.
    </div>
  `;
  resultCard.style.display = "block";
  toast("¡Reporte estadístico extendido generado con éxito!");
}

// Eventos generales e interactivos (Limpiar registros y controles nuevos)
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "clearLogsBtn") {
    facialLogs = [];
    renderFacialLogs();
    toast("Registros limpios.");
  }
  
  // Interacción al hacer clic en el nuevo panel de Transición Emocional
  if (e.target.closest && e.target.closest("#timelineCardTrigger")) {
    if (facialLogs.length > 0) {
      toast(`Último registro activo: ${facialLogs[0].text.replace(/<[^>]*>/g, '')}`);
    } else {
      toast("Inicia la cámara para registrar transiciones en vivo.");
    }
  }
});

// Listener para el control deslizante de sensibilidad
const sensitivityRange = $("#sensitivityRange");
if (sensitivityRange) {
  sensitivityRange.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    minConfidenceThreshold = val / 100;
    $("#sensitivityValueLabel").textContent = `${val}%`;
  });
}

$("#startBtn").addEventListener("click", startCamera);
$("#stopBtn").addEventListener("click", stopCamera);
$("#startSessionAnalysisBtn").addEventListener("click", startSessionAnalysis);

window.addEventListener("pagehide", () => {
  if (stream) stream.getTracks().forEach((track) => track.stop());
});
