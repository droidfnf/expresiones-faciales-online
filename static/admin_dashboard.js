const $ = (selector) => document.querySelector(selector);
const formatNumber = (value, digits = 2) => new Intl.NumberFormat("es-PE", { maximumFractionDigits: digits }).format(Number(value || 0));
const formatPercent = (value) => `${formatNumber(Number(value || 0) * 100, 1)}%`;
const escapeText = (value) => String(value ?? "");

function cell(row, value, className = "") {
  const td = document.createElement("td");
  td.textContent = escapeText(value);
  if (className) td.className = className;
  row.appendChild(td);
  return td;
}

function renderUsers(users, selectedUser) {
  const select = $("#userFilter");
  const prior = selectedUser || select.value || "all";
  select.replaceChildren(new Option("Todos los usuarios", "all"));
  users.forEach((email) => select.add(new Option(email, email)));
  select.value = users.includes(prior) ? prior : "all";

}

function renderUserTable(rows) {
  const body = $("#usersTable");
  body.replaceChildren();
  if (!rows.length) {
    const tr = body.insertRow();
    cell(tr, "No hay usuarios con muestras en este filtro.");
    return;
  }
  rows.forEach((user) => {
    const tr = body.insertRow();
    const td = cell(tr, user.user_email);
    const button = document.createElement("button");
    button.className = "user-link";
    button.type = "button";
    button.textContent = user.user_email;
    button.addEventListener("click", () => {
      $("#userFilter").value = user.user_email;
      loadDashboard();
    });
    td.replaceChildren(button);
    cell(tr, user.samples, "numeric");
    cell(tr, user.dominant_emotion);
    cell(tr, formatPercent(user.mean_confidence), "numeric");
    cell(tr, new Date(user.last_seen).toLocaleString("es-PE"));
  });
}

function renderEvents(rows) {
  const body = $("#eventsTable");
  body.replaceChildren();
  if (!rows.length) {
    const tr = body.insertRow();
    cell(tr, "No hay registros en este período.");
    return;
  }
  rows.forEach((event) => {
    const tr = body.insertRow();
    cell(tr, new Date(event.recorded_at).toLocaleString("es-PE"));
    cell(tr, event.user_email);
    cell(tr, event.emotion);
    cell(tr, formatPercent(event.confidence), "numeric");
    cell(tr, event.sample_type === "capture" ? "Captura manual" : "Muestra en vivo");
  });
}

function renderProbabilityTable(probabilities) {
  const body = $("#probabilityTable");
  body.replaceChildren();
  Object.entries(probabilities).forEach(([label, value]) => {
    const tr = body.insertRow();
    cell(tr, label);
    cell(tr, formatPercent(value), "numeric");
  });
}

function renderSimpleRegression(model) {
  const target = $("#simpleRegression");
  if (!model.available) {
    target.textContent = model.message;
    return;
  }
  target.textContent = `Con ${model.samples} muestras: pendiente m = ${formatNumber(model.slope, 5)}, intercepto b = ${formatNumber(model.intercept, 4)} y R² = ${formatNumber(model.r2, 3)}.`;
}

function renderMultipleRegression(model) {
  const target = $("#multipleRegression");
  const coefficients = $("#coefficients");
  coefficients.replaceChildren();
  if (!model.available) {
    target.textContent = model.message;
    return;
  }
  target.textContent = `Ajuste de mínimos cuadrados sobre ${model.samples} muestras. Intercepto β₀ = ${formatNumber(model.intercept, 4)}; R² = ${formatNumber(model.r2, 3)}.`;
  Object.entries(model.coefficients).forEach(([label, value]) => {
    const chip = document.createElement("span");
    chip.className = "coef";
    chip.textContent = `β ${label}: ${formatNumber(value, 3)}`;
    coefficients.appendChild(chip);
  });
}

function renderSegments(segments) {
  const target = $("#segmentList");
  target.replaceChildren();
  if (!segments.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Se necesitan registros de al menos dos usuarios con patrones distintos.";
    target.appendChild(empty);
    return;
  }
  segments.forEach((segment) => {
    const card = document.createElement("article");
    card.className = "segment";
    const heading = document.createElement("strong");
    heading.textContent = `Segmento ${segment.cluster} · ${segment.user_count} usuario(s)`;
    const note = document.createElement("p");
    note.textContent = `Mayor probabilidad media: ${segment.top_mean_category}. Usuarios: ${segment.users.join(", ")}`;
    card.append(heading, note);
    target.appendChild(card);
  });
}

async function loadDashboard() {
  const status = $("#dashboardStatus");
  status.textContent = "Actualizando datos…";
  const query = new URLSearchParams({
    user: $("#userFilter").value || "all",
    from: $("#fromFilter").value,
    to: $("#toFilter").value,
  });
  try {
    const response = await fetch(`/api/admin/analytics?${query.toString()}`, { headers: { Accept: "application/json" } });
    const data = await response.json();
    if (response.status === 401) {
      window.location.href = "/admin/login";
      return;
    }
    if (!response.ok) throw new Error(data.error || "No se pudieron cargar los datos.");
    renderUsers(data.users || [], data.filters?.user);
    renderUserTable(data.users_summary || []);
    renderEvents(data.recent_events || []);
    renderProbabilityTable(data.stats.mean_distribution || {});
    renderSimpleRegression(data.simple_regression || { available: false, message: "Sin muestras." });
    renderMultipleRegression(data.multiple_regression || { available: false, message: "Sin muestras." });
    renderSegments(data.segments || []);

    const stats = data.stats || {};
    $("#sampleCount").textContent = formatNumber(stats.samples, 0);
    $("#userCount").textContent = formatNumber(stats.users, 0);
    $("#meanConfidence").textContent = formatPercent(stats.mean_confidence);
    $("#topEmotion").textContent = stats.dominant_emotion || "—";
    $("#topEmotionShare").textContent = stats.dominant_emotion ? `${formatPercent(stats.dominant_share)} de las categorías dominantes` : "Sin registros en este filtro";
    $("#statMean").textContent = formatPercent(stats.mean_confidence);
    $("#statMedian").textContent = formatPercent(stats.median_confidence);
    $("#statVariance").textContent = formatNumber(stats.variance, 5);
    $("#statStd").textContent = formatNumber(stats.std_dev, 4);
    $("#userReport").textContent = data.report || "No hay resumen disponible.";
    $("#distributionChart").src = `data:image/png;base64,${data.charts.distribution}`;
    $("#trendChart").src = `data:image/png;base64,${data.charts.trend}`;
    status.textContent = data.truncated ? "Se muestran hasta 20 000 muestras recientes. Reduce el período para explorar datos antiguos." : `${formatNumber(stats.samples, 0)} muestras consultadas.`;
  } catch (error) {
    status.textContent = error.message;
  }
}

$("#applyFilters").addEventListener("click", loadDashboard);
$("#userFilter").addEventListener("change", loadDashboard);
loadDashboard();
