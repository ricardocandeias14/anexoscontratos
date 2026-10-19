// Pantalla: todo se ejecuta en el navegador. No hay ninguna llamada a servidores (solo se piden los archivos de la propia web).
import * as F from "./flujo.js";
import { abrirPdf } from "./extraccion.js";
import { cargarDocx, informe, camposDeModelo, textoModelo } from "./docx.js";

const $ = (id) => document.getElementById(id);
const estado = { contrato: null, deducidos: [], editados: {}, campos: [], bytesPdf: null };

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n[k] = v;
  }
  n.append(...hijos);
  return n;
}
const mensaje = (clase, texto) => el("div", { class: clase, text: texto });

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const descargarJson = (obj, nombre) =>
  descargar(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), nombre);

function mostrarError(e) { $("errorGlobal").replaceChildren(mensaje("error", e.message || String(e))); }

/* ====================== pestañas ====================== */
function mostrarVista(admin) {
  $("vistaAnexo").hidden = admin;
  $("vistaAdmin").hidden = !admin;
  $("tabAnexo").setAttribute("aria-selected", String(!admin));
  $("tabAdmin").setAttribute("aria-selected", String(admin));
  if (admin) admIniciar(); else cargarCatalogoUI(true);
}
$("tabAnexo").addEventListener("click", () => mostrarVista(false));
$("tabAdmin").addEventListener("click", () => mostrarVista(true));

/* ====================== desplegables ====================== */
function rellenarCategorias(conservar) {
  const cats = F.categoriasDe($("convenio").value);
  const opciones = cats.map((c) => el("option", { value: c, text: c }));
  // con varias categorías hay que elegir: así nadie genera con «Grupo 1» por descuido
  if (cats.length > 1) opciones.unshift(el("option", { value: "", text: "— elige la categoría —" }));
  $("categoria").replaceChildren(...opciones);
  if (conservar && cats.includes(conservar)) $("categoria").value = conservar;
  marcarCategoria();
}

function marcarCategoria() {
  $("categoria").classList.toggle("pendiente", !$("categoria").value);
}

function cargarCatalogoUI(conservar = false) {
  const antesConv = $("convenio").value, antesCat = $("categoria").value;
  const cs = F.convenios();
  $("convenio").replaceChildren(...cs.map((c) => el("option", { value: c.nombre, text: c.nombre })));
  if (conservar && cs.some((c) => c.nombre === antesConv)) $("convenio").value = antesConv;
  rellenarCategorias(conservar ? antesCat : undefined);
  if (!cs.length) {
    $("pistaConvenio").replaceChildren(mensaje("error", "No hay modelos publicados todavía. Ve a «Modelos y convenios»."));
    return;
  }
  cargarCampos();
}

/* ====================== vista del PDF (se dibuja con pdf.js, sin salir del navegador) ====================== */
async function dibujarPdf(bytes) {
  const visor = $("visor");
  visor.replaceChildren();
  visor.hidden = false;
  const pdf = await abrirPdf(bytes);
  for (let n = 1; n <= pdf.numPages; n++) {
    const pag = await pdf.getPage(n);
    const vp = pag.getViewport({ scale: 1.6 });
    const lienzo = el("canvas");
    lienzo.width = Math.floor(vp.width); lienzo.height = Math.floor(vp.height);
    visor.append(lienzo);
    await pag.render({ canvasContext: lienzo.getContext("2d"), viewport: vp }).promise;
  }
}

/* ====================== lectura del contrato ====================== */
function mostrarEstado(texto, esError = false, ...avisos) {
  const c = $("estadoLectura");
  c.replaceChildren(el("span", { class: esError ? "error" : "ok", text: texto }));
  for (const a of avisos.flat()) if (a) c.append(typeof a === "string" ? el("div", { class: "aviso", text: a }) : a);
}

const nombreLegible = (k) => k.replace(/_/g, " ").toLowerCase();

async function subirContrato(archivo) {
  if (!archivo) return;
  if (!/\.pdf$/i.test(archivo.name)) { mostrarEstado("Solo se admiten archivos PDF.", true); return; }
  mostrarEstado("Leyendo el contrato…");
  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Error("El archivo no parece un PDF.");
    estado.bytesPdf = bytes;
    dibujarPdf(bytes).catch(() => {});
    const r = await F.leerContrato(bytes, { alProgreso: (t) => mostrarEstado(t), nombreArchivo: archivo.name });
    estado.contrato = r.valores;
    estado.deducidos = r.deducidos;
    estado.editados = {};
    const extras = [];
    if (r.escaneo) extras.push("Era un escaneo: se ha leído con reconocimiento de texto y puede haber errores. Revisa los datos.");
    extras.push(...r.avisosLectura);
    mostrarEstado(`Contrato leído (${Object.keys(r.valores).length} datos).`, false, extras);
    if (r.convenio_sugerido) {
      const antes = $("categoria").value;
      $("convenio").value = r.convenio_sugerido;
      rellenarCategorias(antes);
    }
    const cc = r.valores.CONVENIO_CONTRATO;
    $("pistaConvenio").textContent = cc
      ? `El contrato dice: «${cc}»` + (r.convenio_sugerido ? "." : ". Elige el convenio que corresponda.")
      : "";
    await cargarCampos();
    $("paso2").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { mostrarEstado(e.message, true); }
}

/* ====================== formulario: resumen + solo lo que falta ====================== */
async function cargarCampos() {
  const conv = $("convenio").value, cat = $("categoria").value;
  marcarCategoria();
  if (!conv) return;
  if (!cat) {
    $("paso3").hidden = false;
    $("resumen").replaceChildren();
    $("pendientes").replaceChildren(mensaje("aviso", "Elige la categoría profesional (arriba) para continuar."));
    $("campos").replaceChildren(); $("bloqueGenerar").hidden = true;
    return;
  }
  try {
    // sin contrato leído se aplican igualmente las respuestas por defecto de las reglas
    const deducidos = estado.contrato ? estado.deducidos : F.evaluarReglas({}, "");
    estado.campos = await F.prepararCampos(conv, cat, estado.contrato || {}, estado.editados, deducidos);
    pintarCampos();
    $("errorGlobal").replaceChildren();
  } catch (e) {
    $("paso3").hidden = false;
    $("pendientes").replaceChildren(mensaje("error", e.message));
  }
}

const ORIGEN = { contrato: "del contrato", empresa: "guardado de la empresa", categoria: "del convenio",
  defecto: "por defecto", editado: "escrito a mano", deducido: "deducido", "": "" };

function filaCampo(c) {
  const largo = c.tipo !== "si_no" && ((c.valor || "").length > 70 || c.etiqueta.length > 60);
  let entrada;
  if (c.tipo === "si_no") {
    entrada = el("select", {}, el("option", { value: "", text: "— elige —" }),
      el("option", { value: "Sí", text: "Sí" }), el("option", { value: "No", text: "No" }));
    entrada.value = c.valor || "";
    // cambiar una respuesta añade o quita los apartados que dependen de ella
    entrada.addEventListener("change", () => { estado.editados[c.clave] = entrada.value; recordarValoresEscritos(); cargarCampos(); });
  } else {
    entrada = largo ? el("textarea", { rows: 2, value: c.valor || "" }) : el("input", { type: "text", value: c.valor || "" });
    entrada.addEventListener("input", () => { estado.editados[c.clave] = entrada.value; });
  }
  entrada.dataset.clave = c.clave;
  const pie = el("div", { class: "pie" },
    ...(c.origen && ORIGEN[c.origen] ? [el("span", { class: "chip" + (c.origen === "deducido" ? " chip-deducido" : ""), text: ORIGEN[c.origen], title: c.motivo || "" })] : []),
    ...(c.aviso ? [el("span", { class: "alerta", text: c.aviso })] : []),
    ...(c.nota ? [el("span", { text: c.nota })] : []));
  return el("div", { class: "campo" + (c.aviso ? " revisar" : "") + (largo ? " ancho" : "") },
    el("label", { class: "et", text: c.etiqueta.charAt(0).toUpperCase() + c.etiqueta.slice(1) }), entrada, pie);
}

function bloque(titulo, nota, campos) {
  if (!campos.length) return null;
  return el("div", { class: "bloque" }, el("h3", { text: titulo }), ...(nota ? [el("p", { class: "nota", text: nota })] : []),
    el("div", { class: "grid" }, ...campos.map(filaCampo)));
}

function grupo(titulo, campos) {
  if (!campos.length) return null;
  return el("div", {}, el("h3", { text: `${titulo} (${campos.length})` }), el("div", { class: "grid" }, ...campos.map(filaCampo)));
}

/** Antes de repintar, guarda lo escrito para no perderlo. */
function recordarValoresEscritos() {
  document.querySelectorAll("#paso3 [data-clave]").forEach((n) => {
    const c = estado.campos.find((x) => x.clave === n.dataset.clave);
    if (c && n.value !== c.valor) estado.editados[n.dataset.clave] = n.value;
  });
}

function pintarResumen(v, preguntas) {
  const si = (k) => (preguntas.find((p) => p.clave === k) || {}).valor === "Sí";
  const tipo = [];
  if (si("ES_CONVERSION")) tipo.push("Conversión de temporal en indefinido");
  else tipo.push(si("ES_TEMPORAL") ? "Temporal" : "Indefinido");
  if (si("ES_FIJO_DISCONTINUO")) tipo.push("fijo-discontinuo");
  tipo.push(si("HAY_PERIODO_PRUEBA") ? `con período de prueba${v.PERIODO_PRUEBA ? " (" + v.PERIODO_PRUEBA + ")" : ""}` : "sin período de prueba");
  if (!si("HAY_CONVENIO")) tipo.push("sin convenio colectivo");
  const fila = (et, val) => el("div", {}, el("span", { class: "et", text: et }), el("strong", { text: val || "—" }));
  $("resumen").replaceChildren(
    fila("Persona trabajadora", [v.NOMBRE, v.DOCUMENTO].filter(Boolean).join(" · ")),
    fila("Empresa", [v.EMPRESA, v.CIF_EMPRESA].filter(Boolean).join(" · ")),
    fila("Contrato", tipo.join(", ")),
    ...estado.campos.filter((c) => c.nota).map((c) => mensaje("aviso", c.nota)));
}

function pintarCampos() {
  const campos = estado.campos;
  const v = Object.fromEntries(campos.map((c) => [c.clave, c.valor]));
  const preguntas = campos.filter((c) => c.tipo === "si_no");
  const deEmpresa = new Set(F.estado.camposEmpresa);
  const pendiente = (c) => !c.valor || c.aviso;
  const pend = campos.filter(pendiente);
  const pendEmpresa = pend.filter((c) => deEmpresa.has(c.clave));
  const pendContrato = pend.filter((c) => !deEmpresa.has(c.clave));
  const resto = campos.filter((c) => !pendiente(c));

  pintarResumen(v, preguntas);
  const nombreEmpresa = v.EMPRESA || "la empresa";
  $("pendientes").replaceChildren(...(pend.length ? [
    bloque("Falta en este contrato", "", pendContrato),
    bloque(`Datos de ${nombreEmpresa}`, "Solo la primera vez: se guardan al generar el anexo y la próxima vez saldrán rellenos.", pendEmpresa),
  ].filter(Boolean) : [mensaje("ok", "No falta nada. Revisa el resumen y genera el anexo.")]));

  // todo lo demás, plegado
  const rPreg = resto.filter((c) => c.tipo === "si_no");
  const rTexto = resto.filter((c) => c.tipo !== "si_no");
  $("campos").replaceChildren(...[
    grupo("Tipo de contrato y circunstancias", rPreg),
    grupo("Leídos del contrato", rTexto.filter((c) => c.origen === "contrato")),
    grupo("Deducidos", rTexto.filter((c) => c.origen === "deducido")),
    grupo("Del convenio, de la empresa o por defecto", rTexto.filter((c) => !["contrato", "deducido"].includes(c.origen))),
  ].filter(Boolean));
  $("paso3").hidden = false;
  $("bloqueGenerar").hidden = false;
  $("resultado").replaceChildren();
  $("previa").hidden = true;
  $("btnPrevia").textContent = "Ver cómo queda";
}

function valoresActuales() {
  const v = {};
  document.querySelectorAll("#paso3 [data-clave]").forEach((n) => { v[n.dataset.clave] = n.value; });
  return v;
}

/* ====================== vista previa y generación ====================== */
$("btnPrevia").addEventListener("click", async () => {
  const panel = $("previa");
  if (!panel.hidden) { panel.hidden = true; $("btnPrevia").textContent = "Ver cómo queda"; return; }
  try {
    const r = await F.previsualizarAnexo($("convenio").value, $("categoria").value, valoresActuales());
    panel.replaceChildren(
      mensaje(r.faltan.length ? "aviso" : "ok", r.faltan.length
        ? `Quedan ${r.faltan.length} datos sin rellenar (en amarillo).` : "Así quedará el anexo."),
      ...r.parrafos.map((p) => el("p", {}, ...p.map((t) =>
        el("span", { class: (t.b ? "neg " : "") + (t.falta ? "falta" : ""), text: t.t })))));
    panel.hidden = false;
    $("btnPrevia").textContent = "Ocultar";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) { panel.replaceChildren(mensaje("error", e.message)); panel.hidden = false; }
});

$("btnGenerar").addEventListener("click", async () => {
  if (!$("categoria").value) { alert("Elige primero la categoría profesional."); $("categoria").focus(); return; }
  const valores = valoresActuales();
  const vacios = Object.values(valores).filter((x) => !x.trim()).length;
  if (vacios && !confirm(`Quedan ${vacios} datos sin rellenar. Saldrán resaltados en amarillo en el Word. ¿Generar igualmente?`)) return;
  const btn = $("btnGenerar");
  btn.disabled = true;
  try {
    const r = await F.generarAnexo($("convenio").value, $("categoria").value, valores);
    // los datos de empresa se guardan solos para la próxima vez (en este ordenador)
    let guardados = 0;
    const cif = (valores.CIF_EMPRESA || "").trim();
    if (cif) {
      const datos = Object.fromEntries(F.estado.camposEmpresa.filter((k) => (valores[k] || "").trim()).map((k) => [k, valores[k]]));
      guardados = Object.keys(datos).length;
      if (guardados) { try { F.guardarEmpresa(cif, datos); } catch { guardados = 0; } }
    }
    const url = URL.createObjectURL(r.blob);
    const caja = el("div", {},
      mensaje("ok", "Anexo generado y descargado: " + r.nombre),
      el("a", { href: url, download: r.nombre, text: "Volver a descargar" }));
    if (guardados) caja.append(el("div", { class: "nota", text: `Datos de la empresa guardados: la próxima vez saldrán rellenos.` }));
    if (r.faltan.length) caja.append(mensaje("aviso", `${r.faltan.length} datos quedaron sin rellenar (en amarillo en el Word).`));
    $("resultado").replaceChildren(caja);
    descargar(r.blob, r.nombre);
  } catch (e) { $("resultado").replaceChildren(mensaje("error", e.message)); }
  finally { btn.disabled = false; }
});

$("convenio").addEventListener("change", () => { rellenarCategorias(); cargarCampos(); });
$("categoria").addEventListener("change", () => { recordarValoresEscritos(); cargarCampos(); });

const zona = $("drop");
["dragenter", "dragover"].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add("sobre"); }));
["dragleave", "drop"].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.remove("sobre"); }));
zona.addEventListener("drop", (e) => subirContrato(e.dataTransfer.files[0]));
$("fichero").addEventListener("change", (e) => subirContrato(e.target.files[0]));
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

/* ====================== MODELOS Y CONVENIOS ====================== */
const adm = { cats: [], cols: [], kv: null, kvEmpresa: null, cif: "" };

function crearKV(cont, objeto) {
  const filas = Object.entries(objeto).map(([k, v]) => ({ k, v: v ?? "" }));
  function pintar() {
    cont.replaceChildren(...filas.map((f, i) => {
      const k = el("input", { type: "text", value: f.k, placeholder: "NOMBRE_DEL_DATO" });
      k.addEventListener("input", () => { f.k = k.value; });
      const v = el("textarea", { rows: 1, value: f.v });
      v.addEventListener("input", () => { f.v = v.value; });
      return el("div", { class: "kv" }, k, v,
        el("button", { class: "mini", type: "button", title: "Quitar", text: "×", onclick: () => { filas.splice(i, 1); pintar(); } }));
    }), el("button", { type: "button", text: "+ Añadir dato", onclick: () => { filas.push({ k: "", v: "" }); pintar(); } }));
  }
  pintar();
  return { leer() { const o = {}; filas.forEach((f) => { if (f.k.trim()) o[f.k.trim()] = f.v; }); return o; } };
}

const CLAVE_VALIDA = /^[A-Z0-9_]{1,40}$/;
// El nombre del convenio sirve para derivar el nombre de la carpeta (y, sin acentos, de archivos),
// así que va restringido a caracteres seguros en una ruta.
const NOMBRE_VALIDO = /^[\p{L}\p{N}][\p{L}\p{N}_ .,()\-ºª]{0,80}$/u;
// El nombre de categoría solo se usa como clave dentro de _categorias.json (nunca como ruta de archivo
// desde este panel), así que admite además la barra: es habitual en categorías reales de convenio,
// p. ej. «Profesor/a» o «Ayudante / Mozo especializado».
const CATEGORIA_VALIDA = /^[\p{L}\p{N}][\p{L}\p{N}_ .,()\-ºª/]{0,80}$/u;
function limpiarClaves(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const clave = k.trim().toUpperCase().replace(/\s+/g, "_");
    if (!CLAVE_VALIDA.test(clave)) throw new Error(`Nombre de dato no válido: «${k}» (letras, números y _).`);
    out[clave] = v ?? "";
  }
  return out;
}

function bloqueInforme(inf) {
  const partes = [`${inf.campos} campos`];
  if (inf.del_contrato.length) partes.push(`${inf.del_contrato.length} se rellenan solos con el contrato`);
  if (inf.del_convenio.length) partes.push(`${inf.del_convenio.length} salen de los datos del convenio/categoría`);
  if (inf.a_mano.length) partes.push(`${inf.a_mano.length} hay que completarlos a mano`);
  const d = el("div", {}, el("div", { class: "nota", text: partes.join(" · ") }));
  inf.avisos.forEach((a) => d.append(mensaje("aviso", a)));
  if (inf.a_mano.length) d.append(el("details", {}, el("summary", { text: "Campos que habrá que completar a mano" }),
    el("ul", {}, ...inf.a_mano.map((c) => el("li", {}, el("code", { text: c.clave }), c.etiqueta ? " — " + c.etiqueta : "")))));
  return d;
}

async function informeDeBytes(bytes, convNombre) {
  const modelo = await cargarDocx(bytes);
  const c = convNombre ? F.convenio(convNombre) : null;
  return informe(modelo, { categorias: c ? c.categorias_datos : {}, valores: c ? c.valores : {}, conocidas: F.estado.conocidas });
}

async function comprobarTodo() {
  const cont = $("adminProblemas");
  cont.replaceChildren(mensaje("nota", "Comprobando…"));
  F.olvidarModelos();
  const problemas = [];
  const cs = F.convenios();
  const comun = (F.estado.catalogo.modelos_comunes || []).includes("_base.docx");
  if (!cs.length) problemas.push({ nivel: "error", mensaje: "No hay ningún convenio en la carpeta «modelos»." });
  let modeloComun = null;
  if (comun) {
    try {
      const bytes = await F.bytesModelo("_comun", "_base.docx");
      modeloComun = await cargarDocx(bytes);
      const inf = informe(modeloComun, { conocidas: F.estado.conocidas });
      inf.avisos.forEach((a) => problemas.push({ nivel: "aviso", mensaje: `Modelo común: ${a}` }));
    } catch (e) { problemas.push({ nivel: "error", mensaje: `Modelo común: no se puede abrir (${e.message}).` }); }
  }
  for (const c of cs) {
    const base = c.modelos.includes("_base.docx");
    const propios = c.modelos.filter((m) => !m.startsWith("_")).map((m) => m.replace(/\.docx$/i, ""));
    if (!base && !propios.length && !comun) problemas.push({ nivel: "error", mensaje: `${c.nombre}: no tiene ningún modelo Word.` });
    if (!c.categorias.length) problemas.push({ nivel: "aviso", mensaje: `${c.nombre}: no tiene categorías definidas.` });
    for (const m of c.modelos.filter((x) => !x.startsWith("_") || x === "_base.docx")) {
      try {
        const inf = await informeDeBytes(await F.bytesModelo(c.carpeta, m), c.nombre);
        inf.avisos.forEach((a) => problemas.push({ nivel: "aviso", mensaje: `${c.nombre} / ${m}: ${a}` }));
      } catch (e) { problemas.push({ nivel: "error", mensaje: `${c.nombre} / ${m}: no se puede abrir (${e.message}).` }); }
    }
    // Con el modelo común, cada convenio debe definir las remisiones (REF_...) y su identificación (CONV_...)
    if (!base && modeloComun) {
      const vals = F.upperKeys(c.valores);
      if (!("HAY_CONVENIO" in vals)) problemas.push({ nivel: "error", mensaje: `${c.nombre}: falta HAY_CONVENIO («Sí» o «No») en _valores.json.` });
      const faltan = camposDeModelo(modeloComun, vals).map((x) => x.clave)
        .filter((k) => /^(REF_|CONV_)/.test(k) && !String(vals[k] || "").trim());
      if (faltan.length) problemas.push({ nivel: "error", mensaje: `${c.nombre}: faltan en _valores.json las remisiones ${faltan.join(", ")}.` });
    }
  }
  cont.replaceChildren(...(problemas.length
    ? problemas.map((p) => mensaje(p.nivel === "error" ? "error" : "aviso", p.mensaje))
    : [mensaje("ok", `Todos los modelos pasan la comprobación (${cs.length} convenios).`)]));
}
$("btnComprobarTodo").addEventListener("click", comprobarTodo);

$("admFichero").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const inf = await informeDeBytes(new Uint8Array(await f.arrayBuffer()), $("admComparar").value);
    $("admInforme").replaceChildren(el("div", { class: "modelo" }, bloqueInforme(inf)));
  } catch (err) { $("admInforme").replaceChildren(mensaje("error", err.message)); }
});
$("admComparar").addEventListener("change", () => { $("admFichero").value = ""; $("admInforme").replaceChildren(); });

function pintarCategorias() {
  const cab = el("tr", {}, el("th", { text: "Categoría" }),
    ...adm.cols.map((c, i) => el("th", {}, c + " ",
      el("button", { class: "mini", type: "button", title: "Quitar este dato de todas las categorías", text: "×",
        onclick: () => { adm.cols.splice(i, 1); pintarCategorias(); } }))), el("th"));
  const filas = adm.cats.map((c, j) => {
    const nom = el("input", { type: "text", value: c.nombre, placeholder: "Nombre de la categoría" });
    nom.addEventListener("input", () => { c.nombre = nom.value; });
    return el("tr", {}, el("td", {}, nom),
      ...adm.cols.map((col) => {
        const t = el("textarea", { rows: 1, value: c.datos[col] ?? "" });
        t.addEventListener("input", () => { c.datos[col] = t.value; });
        return el("td", {}, t);
      }),
      el("td", {}, el("button", { class: "mini", type: "button", title: "Quitar esta categoría", text: "×",
        onclick: () => { adm.cats.splice(j, 1); pintarCategorias(); } })));
  });
  $("tablaCategorias").replaceChildren(adm.cats.length ? el("table", { class: "cats" }, cab, ...filas)
    : mensaje("nota", "Sin categorías: añade la primera con «+ Categoría»."));
}

function cargarConvenioAdm() {
  const c = F.convenio($("admConvenio").value);
  adm.cols = [];
  adm.cats = c ? Object.entries(c.categorias_datos).map(([nombre, datos]) => {
    Object.keys(datos).forEach((k) => { if (!adm.cols.includes(k)) adm.cols.push(k); });
    return { nombre, datos: { ...datos } };
  }) : [];
  // categorías que solo existen como modelo propio también aparecen en la tabla
  if (c) c.categorias.filter((n) => !adm.cats.some((x) => x.nombre === n)).forEach((n) => adm.cats.push({ nombre: n, datos: {} }));
  adm.kv = crearKV($("kvConvenio"), c ? c.valores : {});
  $("admNuevo").value = "";
  $("admGuardado").replaceChildren();
  pintarCategorias();
}

function admIniciar() {
  const cs = F.convenios();
  const actual = $("admConvenio").value;
  $("admConvenio").replaceChildren(el("option", { value: "", text: "— elige —" }), ...cs.map((c) => el("option", { value: c.nombre, text: c.nombre })));
  if (cs.some((c) => c.nombre === actual)) $("admConvenio").value = actual; else if (cs.length) $("admConvenio").value = cs[0].nombre;
  $("admComparar").replaceChildren(el("option", { value: "", text: "(ninguno)" }), ...cs.map((c) => el("option", { value: c.nombre, text: c.nombre })));
  cargarConvenioAdm();
  pintarEmpresas();
}
$("admConvenio").addEventListener("change", cargarConvenioAdm);
$("btnNuevaCategoria").addEventListener("click", () => { adm.cats.push({ nombre: "", datos: {} }); pintarCategorias(); });
$("btnNuevaColumna").addEventListener("click", () => {
  const n = prompt("Nombre del dato (mayúsculas y sin espacios, p. ej. SALARIO_BASE, GRUPO, FUNCIONES):");
  if (!n) return;
  const clave = n.trim().toUpperCase().replace(/\s+/g, "_");
  if (!CLAVE_VALIDA.test(clave)) { alert("Usa solo letras, números y _"); return; }
  if (!adm.cols.includes(clave)) adm.cols.push(clave);
  pintarCategorias();
});

$("btnDescargarCategorias").addEventListener("click", () => {
  const dest = $("admGuardado");
  try {
    const nuevo = $("admNuevo").value.trim();
    const nombre = nuevo || $("admConvenio").value;
    if (!nombre) throw new Error("Elige un convenio o escribe el nombre de uno nuevo.");
    if (!NOMBRE_VALIDO.test(nombre) || nombre.includes("..") || nombre.endsWith("."))
      throw new Error("Nombre de convenio no válido (letras, números, espacios y - . , ( ) ).");
    const categorias = {};
    for (const c of adm.cats) {
      const n = c.nombre.trim();
      if (!n) continue;
      if (!CATEGORIA_VALIDA.test(n) || n.includes("..") || n.endsWith(".")) throw new Error(`Nombre de categoría no válido: «${n}».`);
      if (categorias[n]) throw new Error(`La categoría «${n}» está repetida.`);
      categorias[n] = limpiarClaves(Object.fromEntries(adm.cols.map((col) => [col, c.datos[col] || ""])));
    }
    // sin categorías el documento no tendrá filas para elegir: es casi seguro un olvido (p. ej. la
    // respuesta de Claude se quedó corta y no trajo «categorias»), así que se pide confirmación expresa
    // en vez de descargar en silencio un _categorias.json vacío que luego pasa desapercibido en GitHub.
    if (!Object.keys(categorias).length) {
      const seguir = confirm("No hay ninguna categoría cargada: se descargará un _categorias.json vacío ({}) y el convenio no tendrá categorías para elegir.\n\n¿Seguro que quieres continuar sin categorías?");
      if (!seguir) { dest.replaceChildren(mensaje("aviso", "Descarga cancelada. Añade categorías con «+ Categoría» o pide a Claude que complete «categorias» en su respuesta.")); return; }
    }
    descargarJson(categorias, "_categorias.json");
    descargarJson(limpiarClaves(adm.kv.leer()), "_valores.json");
    // la carpeta sin acentos (algunos servidores no sirven bien rutas con acentos); el nombre visible va en _nombre.txt
    const carpeta = (F.convenio(nombre) || {}).carpeta || nombre.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    if (carpeta !== nombre) setTimeout(() => descargar(new Blob([nombre], { type: "text/plain" }), "_nombre.txt"), 400);
    dest.replaceChildren(mensaje("ok", `Descargados. Súbelos a GitHub en public/modelos/${carpeta}/` +
      (carpeta !== nombre ? " (incluido _nombre.txt, que guarda el nombre con acentos)" : "") +
      ". Si el convenio usa el modelo común, no hace falta subir ningún Word."));
  } catch (e) { dest.replaceChildren(mensaje("error", e.message)); }
});

/* ---- preparar convenio con Claude (solo texto público del convenio; nunca datos de trabajadores) ---- */
async function clavesDeConvenio() {
  const modelo = await cargarDocx(await F.bytesModelo("_comun", "_base.docx"));
  const claves = camposDeModelo(modelo, { HAY_CONVENIO: "Sí" })
    .filter((c) => /^(REF_|CONV_)/.test(c.clave))
    .filter((c, i, a) => a.findIndex((x) => x.clave === c.clave) === i);
  // claves que en el modelo van detrás de «de» o «a» (no pueden empezar por «el»)
  claves.trasPreposicion = new Set([...textoModelo(modelo).matchAll(/\b(?:de|a)\s+\{\{\s*(REF_[A-Z0-9_]+)/g)].map((m) => m[1]));
  return claves;
}

async function textoPrompt() {
  const claves = await clavesDeConvenio();
  const ejemplo = F.convenios().find((c) => c.valores && c.valores.HAY_CONVENIO === "Sí");
  return [
    "Te adjunto el texto oficial de un convenio colectivo. Necesito los datos para el documento informativo del art. 8.5 ET y del Real Decreto 723/2026 (art. 3.2 y remisiones del art. 3.3).",
    "Devuelve SOLO un JSON con esta forma y EN ESTE ORDEN DE CLAVES: {\"nombre\": \"nombre corto del convenio\", \"categorias\": {...}, \"valores\": {...}}.",
    "Importante: escribe \"categorias\" antes que \"valores\" y complétalo entero, sin dejarlo para el final. Si la respuesta se queda corta de espacio, acorta las descripciones de \"valores\" antes que omitir o recortar \"categorias\"; nunca lo dejes vacío ni a medias. Si el convenio tiene muchas categorías, inclúyelas todas igualmente, aunque tengas que resumir mucho FUNCIONES.",
    "",
    "En \"categorias\", una entrada por cada grupo o categoría profesional del convenio (no te dejes ninguna): {\"Nombre\": {\"GRUPO\": \"número o nombre del grupo\", \"FUNCIONES\": \"descripción resumida de funciones según el convenio\"}}. Si el convenio trae tabla salarial, añade también \"SALARIO_BASE\" por categoría.",
    "",
    "En \"valores\", pon \"HAY_CONVENIO\": \"Sí\" y estas claves (texto en español jurídico, citando artículos concretos del convenio y, cuando proceda, del Estatuto de los Trabajadores):",
    ...claves.map((c) => `- ${c.clave}: ${c.etiqueta}`),
    "",
    "Reglas de redacción: cada REF_ se inserta en mitad de una frase, así que no empieces con mayúscula ni termines en punto, y no empieces por «el artículo» (usa «lo dispuesto en el artículo…» o «los artículos…»). CONV_PUBLICACION empieza por «el Boletín…» o «el Diario…» con la fecha. CONV_VIGENCIA incluye el período y la prórroga o ultraactividad.",
    "Si un dato no figura en el convenio, remite al artículo del Estatuto de los Trabajadores aplicable y dilo. No inventes artículos ni cuantías.",
    "",
    ...(ejemplo ? ["Ejemplo de valores ya preparados para otro convenio:", JSON.stringify(ejemplo.valores, null, 1)] : []),
  ].join("\n");
}

$("btnCopiarPrompt").addEventListener("click", async () => {
  const t = await textoPrompt();
  const area = $("admPrompt");
  area.value = t; area.hidden = false;
  try { await navigator.clipboard.writeText(t); $("btnCopiarPrompt").textContent = "Copiado ✓"; }
  catch { area.select(); $("btnCopiarPrompt").textContent = "Selecciona el texto y cópialo (Ctrl+C)"; }
});

$("btnCargarRespuesta").addEventListener("click", async () => {
  const dest = $("admRespuestaEstado");
  try {
    let t = $("admRespuesta").value.trim();
    const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (bloque) t = bloque[1];
    t = t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
    let d;
    try { d = JSON.parse(t); } catch { throw new Error("La respuesta no es un JSON válido. Pide a Claude que devuelva solo el JSON."); }
    const valores = limpiarClaves(d.valores || {});
    const categorias = d.categorias || {};
    const avisos = [];
    const claves = await clavesDeConvenio();
    const faltan = claves.map((c) => c.clave).filter((k) => !String(valores[k] || "").trim());
    if (faltan.length) avisos.push(`Faltan: ${faltan.join(", ")}. Complétalos en «Valores comunes» antes de descargar.`);
    for (const [k, v] of Object.entries(valores)) {
      if (claves.trasPreposicion.has(k) && /^el\s/i.test(v)) avisos.push(`${k} empieza por «el…»: quedaría «de el…». Cámbialo por «lo dispuesto en el…».`);
      if (/^REF_/.test(k) && /\.$/.test(v.trim())) avisos.push(`${k} termina en punto: quítalo, va en mitad de una frase.`);
    }
    if (!valores.HAY_CONVENIO) valores.HAY_CONVENIO = "Sí";
    if (!Object.keys(categorias).length) avisos.push("No trae ninguna categoría: es habitual que la respuesta se corte antes de llegar a «categorias». Pide a Claude que te dé solo ese bloque, o añádelas a mano con «+ Categoría» antes de descargar.");
    // cargar en el editor
    adm.cols = [];
    adm.cats = Object.entries(categorias).map(([nombre, datos]) => {
      const lim = limpiarClaves(datos || {});
      Object.keys(lim).forEach((k) => { if (!adm.cols.includes(k)) adm.cols.push(k); });
      return { nombre, datos: lim };
    });
    adm.kv = crearKV($("kvConvenio"), valores);
    $("admConvenio").value = "";
    $("admNuevo").value = d.nombre || "";
    pintarCategorias();
    dest.replaceChildren(mensaje("ok", `Cargado: ${adm.cats.length} categorías y ${Object.keys(valores).length} valores. Revísalos abajo y descarga los archivos.`),
      ...avisos.map((a) => mensaje("aviso", a)));
    $("tablaCategorias").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { dest.replaceChildren(mensaje("error", e.message)); }
});

/* ---- empresas ---- */
function pintarEmpresas() {
  const sel = $("admEmpresa");
  const antes = sel.value;
  const lista = F.listarEmpresas();
  sel.replaceChildren(el("option", { value: "", text: "— elige una empresa —" }), ...lista.map((c) => el("option", { value: c, text: c })));
  if (lista.includes(antes)) sel.value = antes;
  cargarEmpresaAdm(sel.value);
}
function cargarEmpresaAdm(cif) {
  adm.cif = cif;
  $("admEmpresaEstado").replaceChildren();
  const hay = !!cif;
  $("btnGuardarEmpresa").hidden = !hay; $("btnDescargarEmpresa").hidden = !hay;
  if (!hay) { $("kvEmpresa").replaceChildren(); adm.kvEmpresa = null; return; }
  adm.kvEmpresa = crearKV($("kvEmpresa"), F.cargarEmpresa(cif));
}
$("admEmpresa").addEventListener("change", () => cargarEmpresaAdm($("admEmpresa").value));
$("btnNuevaEmpresa").addEventListener("click", () => {
  const cif = (prompt("CIF de la empresa:") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cif) return;
  const s = $("admEmpresa");
  if (![...s.options].some((o) => o.value === cif)) s.append(el("option", { value: cif, text: cif }));
  s.value = cif;
  cargarEmpresaAdm(cif);
});
$("btnGuardarEmpresa").addEventListener("click", () => {
  try {
    F.guardarEmpresa(adm.cif, limpiarClaves(adm.kvEmpresa.leer()), { reemplazar: true });
    $("admEmpresaEstado").replaceChildren(mensaje("ok", "Guardado en este navegador."));
  } catch (e) { $("admEmpresaEstado").replaceChildren(mensaje("error", e.message)); }
});
$("btnDescargarEmpresa").addEventListener("click", () => {
  try {
    const datos = Object.fromEntries(Object.entries(limpiarClaves(adm.kvEmpresa.leer())).filter(([, v]) => String(v).trim()));
    descargarJson(datos, `${adm.cif}.json`);
    $("admEmpresaEstado").replaceChildren(mensaje("ok", `Descargado ${adm.cif}.json. Súbelo a public/empresas/ en GitHub para que lo usen todos.`));
  } catch (e) { $("admEmpresaEstado").replaceChildren(mensaje("error", e.message)); }
});

/* ====================== arranque ====================== */
F.iniciar().then(() => cargarCatalogoUI()).catch(mostrarError);
