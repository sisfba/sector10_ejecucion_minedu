/* Ejecución presupuestal Sector 10 — versión celular.
   Lee los datos resumidos de Supabase (funciones mv_*) con la sesión del usuario. */
"use strict";

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const $ = (s) => document.querySelector(s);
const M = 1e6;
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
const COLORES_ANIO = ["#F59E0B", "#2563EB", "#DC2626"]; // antepenúltimo ámbar, penúltimo azul, actual rojo
const NIVELES = ["Genérica", "Subgenérica", "Subgenérica detalle", "Específica", "Específica detalle"];
const GRUPOS = { "": "Todo el sector", U: "Universidades", M: "MINEDU y organismos públicos" };

const estado = {
  anio: null, grupo: "", pliego: null, ue: null,
  anios: [], cortes: {}, pliegos: [], ues: [],
  vista: "resumen", ruta: [], entVista: "pliegos", cache: new Map(),
};
let graficos = [];

// ------------------------------------------------------------------ utilidades
const mill = (x) => (x / M).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x) => (x == null || !isFinite(x) ? "—" : (x * 100).toFixed(1) + "%");
const div = (a, b) => (b ? a / b : null);
const sem = (x) => (x == null ? "" : x >= 0.8 ? "v" : x >= 0.7 ? "a" : "r");
const colorSem = (x) => (x == null ? "#94A3B8" : x >= 0.8 ? "#16A34A" : x >= 0.7 ? "#F59E0B" : "#DC2626");
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fecha = (iso) => (iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(2, 4) : "");

function cargando(si) { $("#cargando").hidden = !si; }

async function rpc(fn, args) {
  const clave = fn + JSON.stringify(args);
  if (estado.cache.has(clave)) return estado.cache.get(clave);
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  estado.cache.set(clave, data);
  return data;
}

function filtros(extra = {}) {
  return { p_pliego: estado.pliego || null, p_sec: estado.ue || null, p_grupo: estado.grupo || null, ...extra };
}

function nombreAmbito() {
  if (estado.ue) return (estado.ues.find((u) => u.sec_ejec === estado.ue) || {}).nombre || estado.ue;
  if (estado.pliego) return (estado.pliegos.find((p) => p.pliego === estado.pliego) || {}).nombre || estado.pliego;
  return GRUPOS[estado.grupo];
}

function limpiarGraficos() { graficos.forEach((g) => g.destroy()); graficos = []; }

// ------------------------------------------------------------------ sesión
async function iniciar() {
  sb.auth.onAuthStateChange((evento) => {
    if (evento === "PASSWORD_RECOVERY") mostrarCambioClave();
  });
  const hash = location.hash || "";
  const { data } = await sb.auth.getSession();
  if (data.session && /type=(invite|recovery)/.test(hash)) return mostrarCambioClave();
  if (data.session) return entrar(data.session);
  $("#pantalla-login").hidden = false;
}

function mostrarCambioClave() {
  $("#pantalla-login").hidden = true; $("#app").hidden = true; $("#pantalla-clave").hidden = false;
}

$("#form-clave").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("#c-clave").value });
  if (error) { $("#c-error").textContent = "No se pudo guardar: " + error.message; $("#c-error").hidden = false; return; }
  history.replaceState(null, "", location.pathname);
  $("#pantalla-clave").hidden = true;
  const { data } = await sb.auth.getSession();
  entrar(data.session);
});

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#l-error"); err.hidden = true; cargando(true);
  const { data, error } = await sb.auth.signInWithPassword({ email: $("#l-correo").value.trim(), password: $("#l-clave").value });
  cargando(false);
  if (error) {
    err.textContent = /invalid/i.test(error.message) ? "Correo o contraseña incorrectos." : error.message;
    err.hidden = false; return;
  }
  entrar(data.session);
});

$("#l-olvido").addEventListener("click", async () => {
  const correo = $("#l-correo").value.trim();
  const err = $("#l-error");
  if (!correo) { err.textContent = "Escriba su correo y vuelva a pulsar «¿Olvidó su contraseña?»."; err.className = "error"; err.hidden = false; return; }
  await sb.auth.resetPasswordForEmail(correo, { redirectTo: location.origin + location.pathname });
  err.textContent = "Si el correo está registrado, recibirá un enlace para definir una nueva contraseña.";
  err.className = "ok"; err.hidden = false;
});

async function entrar(sesion) {
  $("#pantalla-login").hidden = true; $("#pantalla-clave").hidden = true; $("#app").hidden = false;
  $("#menu-usuario").textContent = sesion.user.email;
  try { localStorage && Object.assign(estado, JSON.parse(localStorage.getItem("ambito") || "{}")); } catch (_) {}
  cargando(true);
  try {
    await cargarCortes();
    await cargarCatalogos();
    pintarCabecera();
    await mostrar(estado.vista);
  } catch (e) { $("#vista").innerHTML = `<p class="vacio">No se pudieron leer los datos.<br>${esc(e.message)}</p>`; }
  cargando(false);
}

async function cargarCortes() {
  const { data, error } = await sb.from("mv_corte").select("anio, fecha_corte, actualizado").order("anio", { ascending: false });
  if (error) throw error;
  estado.anios = data.map((r) => r.anio);
  estado.cortes = Object.fromEntries(data.map((r) => [r.anio, r]));
  if (!estado.anios.includes(estado.anio)) estado.anio = estado.anios[0] || null;
}

async function cargarCatalogos() {
  const [p, u] = await Promise.all([
    sb.from("mv_pliego").select("pliego, nombre").eq("anio", estado.anio).order("pliego"),
    sb.from("mv_ejecutora").select("sec_ejec, pliego, nombre").eq("anio", estado.anio).order("nombre"),
  ]);
  estado.pliegos = p.data || []; estado.ues = u.data || [];
  if (estado.pliego && !estado.pliegos.some((x) => x.pliego === estado.pliego)) estado.pliego = null;
  if (estado.ue && !estado.ues.some((x) => x.sec_ejec === estado.ue)) estado.ue = null;
}

function guardarAmbito() {
  try { localStorage.setItem("ambito", JSON.stringify({ anio: estado.anio, grupo: estado.grupo, pliego: estado.pliego, ue: estado.ue, vista: estado.vista })); } catch (_) {}
}

function pintarCabecera() {
  $("#btn-ambito").textContent = `${nombreAmbito()} · ${estado.anio ?? ""}`;
  const c = estado.cortes[estado.anio];
  $("#corte").textContent = c ? `Fuente: SIAF-SP al ${fecha(c.fecha_corte)} · millones de S/` : "Sin datos cargados todavía.";
}

// ------------------------------------------------------------------ menú y ámbito
$("#btn-menu").addEventListener("click", (e) => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; });
document.addEventListener("click", () => { $("#menu").hidden = true; });
$("#btn-salir").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
$("#btn-actualizar").addEventListener("click", async () => {
  estado.cache.clear(); cargando(true);
  await cargarCortes(); await cargarCatalogos(); pintarCabecera(); await mostrar(estado.vista); cargando(false);
});

function opcionesPliego() {
  const s = $("#f-pliego");
  const grupos = Object.entries(GRUPOS).map(([k, v]) => `<option value="g:${k}">${v}</option>`).join("");
  const pl = estado.pliegos.map((p) => `<option value="p:${p.pliego}">${esc(p.pliego)} ${esc(p.nombre)}</option>`).join("");
  s.innerHTML = `<optgroup label="Agrupaciones">${grupos}</optgroup><optgroup label="Pliegos">${pl}</optgroup>`;
  s.value = estado.pliego ? "p:" + estado.pliego : "g:" + estado.grupo;
}
function opcionesUe() {
  const v = $("#f-pliego").value;
  const s = $("#f-ue");
  if (!v.startsWith("p:")) { s.innerHTML = `<option value="">Todas</option>`; s.disabled = true; return; }
  const lista = estado.ues.filter((u) => u.pliego === v.slice(2));
  s.disabled = lista.length < 2;
  s.innerHTML = `<option value="">Todas (pliego consolidado)</option>` +
    lista.map((u) => `<option value="${u.sec_ejec}">${esc(u.nombre)}</option>`).join("");
  s.value = estado.ue && lista.some((u) => u.sec_ejec === estado.ue) ? estado.ue : "";
}

$("#btn-ambito").addEventListener("click", () => {
  $("#f-anio").innerHTML = estado.anios.map((a) => `<option>${a}</option>`).join("");
  $("#f-anio").value = estado.anio;
  opcionesPliego(); opcionesUe();
  $("#dlg-ambito").showModal();
});
$("#f-pliego").addEventListener("change", opcionesUe);
$("#f-anio").addEventListener("change", async () => {
  estado.anio = +$("#f-anio").value; await cargarCatalogos(); opcionesPliego(); opcionesUe();
});
$("#dlg-ambito").addEventListener("close", async () => {
  if ($("#dlg-ambito").returnValue !== "ok") return;
  const v = $("#f-pliego").value;
  estado.grupo = v.startsWith("g:") ? v.slice(2) : "";
  estado.pliego = v.startsWith("p:") ? v.slice(2) : null;
  estado.ue = estado.pliego ? $("#f-ue").value || null : null;
  estado.anio = +$("#f-anio").value;
  estado.ruta = [];
  guardarAmbito(); pintarCabecera();
  cargando(true); await mostrar(estado.vista); cargando(false);
});

// ------------------------------------------------------------------ navegación
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", async () => {
  cargando(true); await mostrar(b.dataset.vista); cargando(false); window.scrollTo(0, 0);
}));

async function mostrar(vista) {
  estado.vista = vista; guardarAmbito();
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("activo", b.dataset.vista === vista));
  limpiarGraficos();
  if (!estado.anio) { $("#vista").innerHTML = `<p class="vacio">Todavía no hay datos en la nube.</p>`; return; }
  try {
    await { resumen: vResumen, consulta: vConsulta, entidades: vEntidades, historico: vHistorico }[vista]();
  } catch (e) {
    $("#vista").innerHTML = `<p class="vacio">No se pudo leer la información.<br><small>${esc(e.message)}</small></p>`;
  }
}

// ------------------------------------------------------------------ componentes
function kpi(titulo, valor, sub, avance, ancho) {
  const barra = avance == null ? "" :
    `<div class="barra"><div style="width:${Math.max(0, Math.min(avance, 1)) * 100}%;background:${colorSem(avance)}"></div></div>`;
  const borde = avance == null ? "" : `style="border-left-color:${colorSem(avance)}"`;
  return `<div class="kpi${ancho ? " ancho" : ""}" ${borde}><div class="k-t">${titulo}</div><div class="k-v">${valor}</div>` +
    `<div class="k-s">${sub || ""}</div>${barra}</div>`;
}

/* filas: [{nombre, sub?, pim, compromiso, devengado, clave?}] */
function tabla(filas, { titulo = "Concepto", total = true, alPulsar = null } = {}) {
  const t = filas.reduce((a, f) => ({ pim: a.pim + f.pim, compromiso: a.compromiso + f.compromiso, devengado: a.devengado + f.devengado }),
    { pim: 0, compromiso: 0, devengado: 0 });
  const fila = (f, i, clase = "") => {
    const ac = div(f.compromiso, f.pim), ad = div(f.devengado, f.pim);
    const toca = alPulsar && f.clave != null ? " toca" : "";
    return `<div class="fila${clase}${toca}" ${toca ? `data-i="${i}"` : ""}>
      <div class="n"><b>${esc(f.nombre)}</b><small>Pendiente S/ ${mill(f.pim - f.devengado)} M${f.sub ? " · " + esc(f.sub) : ""}</small></div>
      <div class="num">${mill(f.pim)}</div>
      <div class="sem ${sem(ac)}">${pct(ac)}</div><div class="sem ${sem(ad)}">${pct(ad)}</div></div>`;
  };
  const html = `<div class="tabla"><div class="fila cab"><div>${titulo}</div><div class="num">PIM</div>` +
    `<div style="text-align:center">% Comp.</div><div style="text-align:center">% Dev.</div></div>` +
    filas.map((f, i) => fila(f, i)).join("") +
    (total && filas.length > 1 ? fila({ nombre: "TOTAL", ...t }, -1, " total") : "") + `</div>`;
  return { html, conectar: (cont) => {
    if (!alPulsar) return;
    cont.querySelectorAll(".fila.toca").forEach((el) => el.addEventListener("click", () => alPulsar(filas[+el.dataset.i])));
  } };
}

const LEYENDA = `<div class="leyenda">Semáforo (compromiso y devengado):
  <span class="sem v">≥ 80 %</span><span class="sem a">70 % – 79 %</span><span class="sem r">&lt; 70 %</span></div>`;

function curva(canvas, series) {
  const ultimo = series.length - 1;
  graficos.push(new Chart(canvas, {
    type: "line",
    data: {
      labels: MESES,
      datasets: series.map((s, i) => {
        const col = COLORES_ANIO[COLORES_ANIO.length - series.length + i] || "#64748B";
        return { label: String(s.anio), data: s.datos, borderColor: col, backgroundColor: col,
          borderWidth: i === ultimo ? 3.5 : 2, pointRadius: i === ultimo ? 3 : 2, tension: 0.25, spanGaps: false };
      }),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${(c.parsed.y * 100).toFixed(1)}%` } } },
      scales: { y: { min: 0, max: 1, ticks: { callback: (v) => v * 100 + "%", font: { size: 10 } } },
        x: { ticks: { font: { size: 10 } } } },
    },
  }));
}

function seriesAcumuladas(datos) {
  const corteActual = estado.cortes[estado.anio]?.fecha_corte;
  const mesCorte = corteActual ? +corteActual.slice(5, 7) : 12;
  return datos.map((r) => {
    let acum = 0;
    const tope = r.anio === estado.anio ? mesCorte : 12;
    return { anio: r.anio, datos: r.m.map((v, i) => (i < tope ? (acum += v) / (r.pim || 1) : null)) };
  });
}

// ------------------------------------------------------------------ vistas
async function vResumen() {
  const anio = estado.anio;
  const anios = estado.anios.filter((a) => a <= anio).slice(0, 3).reverse();
  const [gen, mens] = await Promise.all([
    rpc("mv_por_nivel", { p_anio: anio, p_nivel: 0, ...filtros() }),
    rpc("mv_mensual", { p_anios: anios, ...filtros() }),
  ]);
  if (!gen.length) { $("#vista").innerHTML = `<p class="vacio">No hay presupuesto para este ámbito.</p>`; return; }
  const s = (k) => gen.reduce((a, r) => a + r[k], 0);
  const pim = s("pim"), cert = s("certificado"), comp = s("compromiso"), dev = s("devengado");
  const filas = gen.map((r) => ({ nombre: r.concepto, pim: r.pim, compromiso: r.compromiso, devengado: r.devengado, clave: r.codigo }));
  const t = tabla(filas, { titulo: "Genérica de gasto", alPulsar: (f) => { estado.ruta = [{ codigo: f.clave, nombre: f.nombre }]; mostrar("consulta"); } });
  $("#vista").innerHTML = `
    <div class="kpis">
      ${kpi("PIM", "S/ " + mill(pim) + " M", "PIA y modificaciones")}
      ${kpi("Certificado", pct(div(cert, pim)), "S/ " + mill(cert) + " M", null)}
      ${kpi("Compromiso anual", pct(div(comp, pim)), "S/ " + mill(comp) + " M", div(comp, pim))}
      ${kpi("Devengado", pct(div(dev, pim)), "S/ " + mill(dev) + " M", div(dev, pim))}
      ${kpi("Pendiente de ejecutar", "S/ " + mill(pim - dev) + " M", pct(div(pim - dev, pim)) + " del PIM", null, true)}
    </div>
    <h2>Estado por genérica</h2>${t.html}${LEYENDA}
    <p class="nota">Toque una genérica para ver su detalle.</p>
    <h2>Avance acumulado del devengado</h2>
    <div class="grafico"><canvas id="g-curva"></canvas></div>`;
  t.conectar($("#vista"));
  curva($("#g-curva"), seriesAcumuladas(mens));
}

async function vConsulta() {
  const nivel = estado.ruta.length;
  const prefijo = nivel ? estado.ruta[nivel - 1].codigo : null;
  const datos = await rpc("mv_por_nivel", { p_anio: estado.anio, p_nivel: Math.min(nivel, 4), p_prefijo: prefijo, ...filtros() });
  const puedeBajar = nivel < 4;
  const filas = datos.map((r) => ({ nombre: r.concepto, pim: r.pim, compromiso: r.compromiso, devengado: r.devengado,
    clave: puedeBajar ? r.codigo : null }));
  const migas = [{ codigo: null, nombre: "Todas las genéricas" }, ...estado.ruta]
    .map((m, i) => `<button data-n="${i}" class="${i === nivel ? "actual" : ""}">${esc(i ? m.nombre : m.nombre)}</button>`).join("");
  const t = tabla(filas, { titulo: NIVELES[Math.min(nivel, 4)], total: true,
    alPulsar: puedeBajar ? (f) => { estado.ruta.push({ codigo: f.clave, nombre: f.nombre }); cargando(true); mostrar("consulta").then(() => { cargando(false); scrollTo(0, 0); }); } : null });
  $("#vista").innerHTML = `<div class="migas">${migas}</div>
    ${filas.length ? t.html + LEYENDA : `<p class="vacio">Sin registros.</p>`}
    ${puedeBajar && filas.length ? `<p class="nota">Toque una fila para bajar al siguiente nivel.</p>` : ""}`;
  t.conectar($("#vista"));
  $("#vista").querySelectorAll(".migas button").forEach((b) => b.addEventListener("click", () => {
    estado.ruta = estado.ruta.slice(0, +b.dataset.n); cargando(true); mostrar("consulta").then(() => cargando(false));
  }));
}

async function vEntidades() {
  // Sector o agrupación: pliegos (o UEs); pliego: sus UEs; UE: no aplica
  if (estado.ue) {
    $("#vista").innerHTML = `<p class="vacio">El ámbito actual es una sola unidad ejecutora.<br>Cambie el ámbito para comparar entidades.</p>`;
    return;
  }
  const porPliego = !estado.pliego && estado.entVista === "pliegos";
  const datos = porPliego
    ? await rpc("mv_por_pliego", { p_anio: estado.anio, p_grupo: estado.grupo || null })
    : await rpc("mv_por_ue", { p_anio: estado.anio, p_pliego: estado.pliego || null, p_grupo: estado.grupo || null });
  const filas = datos.map((r) => ({ nombre: r.nombre, sub: porPliego ? "Pliego " + r.pliego : null, pim: r.pim,
    compromiso: r.compromiso, devengado: r.devengado, clave: porPliego ? r.pliego : r.sec_ejec, pliego: r.pliego }));
  const t = tabla(filas, { titulo: porPliego ? "Pliego" : "Unidad ejecutora",
    alPulsar: async (f) => {
      if (porPliego) { estado.pliego = f.clave; estado.grupo = ""; estado.ue = null; }
      else { estado.pliego = f.pliego; estado.ue = f.clave; estado.grupo = ""; }
      guardarAmbito(); pintarCabecera(); cargando(true); await mostrar("resumen"); cargando(false); scrollTo(0, 0);
    } });
  const seg = estado.pliego ? "" : `<div class="segmento">
      <button data-e="pliegos" class="${estado.entVista === "pliegos" ? "activo" : ""}">Por pliego</button>
      <button data-e="ues" class="${estado.entVista === "ues" ? "activo" : ""}">Por unidad ejecutora</button></div>`;
  $("#vista").innerHTML = `${seg}<h2>${porPliego ? "Avance por pliego" : "Avance por unidad ejecutora"}</h2>
    ${t.html}${LEYENDA}<p class="nota">Ordenadas por PIM. Toque una fila para ver su resumen.</p>`;
  t.conectar($("#vista"));
  $("#vista").querySelectorAll(".segmento button").forEach((b) => b.addEventListener("click", async () => {
    estado.entVista = b.dataset.e; cargando(true); await mostrar("entidades"); cargando(false);
  }));
}

async function vHistorico() {
  const anios = estado.anios.filter((a) => a <= estado.anio).slice(0, 3).reverse();
  const porAnio = await Promise.all(anios.map((a) => rpc("mv_por_nivel", { p_anio: a, p_nivel: 0, ...filtros() })));
  const codigos = [...new Set(porAnio.flat().map((r) => r.codigo))].sort((a, b) => +a.split(".")[1] - +b.split(".")[1]);
  const nombre = Object.fromEntries(porAnio.flat().map((r) => [r.codigo, r.concepto]));
  const totales = porAnio.map((d) => ({ pim: d.reduce((a, r) => a + r.pim, 0), dev: d.reduce((a, r) => a + r.devengado, 0) }));
  const cab = anios.map((a) => `<div style="text-align:center">Av. ${a}</div>`).join("");
  const celdas = (cod) => porAnio.map((d) => {
    const r = d.find((x) => x.codigo === cod); const av = r ? div(r.devengado, r.pim) : null;
    return `<div class="sem ${sem(av)}">${pct(av)}</div>`;
  }).join("");
  const filaPend = (cod) => { const r = porAnio[porAnio.length - 1].find((x) => x.codigo === cod); return r ? mill(r.pim - r.devengado) : "—"; };
  const grid = `style="grid-template-columns:minmax(0,1fr) ${anios.map(() => "58px").join(" ")}"`;
  const tarjetas = anios.map((a, i) => kpi(`Pendiente ${a}`, "S/ " + mill(totales[i].pim - totales[i].dev) + " M",
    `Avance ${pct(div(totales[i].dev, totales[i].pim))}`, div(totales[i].dev, totales[i].pim), anios.length === 3 && i === 2)).join("");
  $("#vista").innerHTML = `<div class="kpis">${tarjetas}</div>
    <h2>Avance del devengado por genérica</h2>
    <div class="tabla"><div class="fila cab" ${grid}><div>Genérica</div>${cab}</div>
      ${codigos.map((c) => `<div class="fila" ${grid}><div class="n"><b>${esc(nombre[c])}</b><small>Pendiente ${anios[anios.length - 1]}: S/ ${filaPend(c)} M</small></div>${celdas(c)}</div>`).join("")}
      <div class="fila total" ${grid}><div class="n"><b>TOTAL</b></div>${totales.map((t) => { const av = div(t.dev, t.pim); return `<div class="sem ${sem(av)}">${pct(av)}</div>`; }).join("")}</div>
    </div>${LEYENDA}
    <p class="nota">Pendiente = PIM − devengado. El año en curso se mide a la fecha de corte.</p>
    <h2>PIM y devengado por año (millones)</h2>
    <div class="grafico"><canvas id="g-barras"></canvas></div>`;
  graficos.push(new Chart($("#g-barras"), {
    type: "bar",
    data: { labels: anios.map(String), datasets: [
      { label: "PIM", data: totales.map((t) => t.pim / M), backgroundColor: "#9CC9E8", borderRadius: 6 },
      { label: "Devengado", data: totales.map((t) => t.dev / M), backgroundColor: "#173A6B", borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: S/ ${c.parsed.y.toLocaleString("en-US", { maximumFractionDigits: 2 })} M` } } },
      scales: { y: { ticks: { callback: (v) => v.toLocaleString("en-US") } } } },
  }));
}

// ------------------------------------------------------------------ arranque
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
iniciar();
