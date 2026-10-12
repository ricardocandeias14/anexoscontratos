// Pantalla: todo se ejecuta en el navegador. No hay ninguna llamada a servidores (solo se piden los archivos de la propia web).
import * as F from "./flujo.js";
import { abrirPdf } from "./extraccion.js";
import { cargarDocx, informe } from "./docx.js";

const $ = (id) => document.getElementById(id);
const estado = { contrato: null, editados: {}, campos: [], bytesPdf: null };

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
  $("categoria").replaceChildren(...cats.map((c) => el("option", { value: c, text: c })));
  if (conservar && cats.includes(conservar)) $("categoria").value = conservar;
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
function mostrarEstado(texto, esError = false, aviso = "") {
  const c = $("estadoLectura");
  c.replaceChildren(el("span", { class: esError ? "error" : "ok", text: texto }));
  if (aviso) c.append(el("div", { class: "aviso", text: aviso }));
}

async function subirContrato(archivo) {
  if (!archivo) return;
  if (!/\.pdf$/i.test(archivo.name)) { mostrarEstado("Solo se admiten archivos PDF.", true); return; }
  mostrarEstado("Leyendo el contrato…");
  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Error("El archivo no parece un PDF.");
    estado.bytesPdf = bytes;
    dibujarPdf(bytes).catch(() => {});
    const r = await F.leerContrato(bytes, { alProgreso: (t) => mostrarEstado(t) });
    estado.contrato = r.valores;
    estado.editados = {};
    mostrarEstado(`Contrato leído: ${Object.keys(r.valores).length} datos detectados.`, false, r.escaneo
      ? "El PDF es un escaneo: se ha leído con OCR, que puede equivocarse. Revisa todos los datos con atención." : "");
    if (r.convenio_sugerido) {
      const antes = $("categoria").value;
      $("convenio").value = r.convenio_sugerido;
      rellenarCategorias(antes);
    }
    const cc = r.valores.CONVENIO_CONTRATO;
    $("pistaConvenio").textContent = cc
      ? `El contrato indica el convenio: «${cc}»` + (r.convenio_sugerido ? " (seleccionado automáticamente)." : ". Elige el modelo que corresponda.")
      : "";
    await cargarCampos();
  } catch (e) { mostrarEstado(e.message, true); }
}

/* ====================== formulario de revisión ====================== */
async function cargarCampos() {
  const conv = $("convenio").value, cat = $("categoria").value;
  if (!conv || !cat) return;
  try {
    estado.campos = await F.prepararCampos(conv, cat, estado.contrato || {}, estado.editados);
    pintarCampos();
    $("errorGlobal").replaceChildren();
  } catch (e) {
    $("paso3").hidden = false;
    $("mensajeCampos").replaceChildren(mensaje("error", e.message));
  }
}

const ORIGEN = { contrato: "del contrato", empresa: "datos de la empresa", categoria: "de la categoría",
  defecto: "por defecto", editado: "editado", "": "sin rellenar" };

function filaCampo(c) {
  const largo = (c.valor || "").length > 70 || c.etiqueta.length > 70;
  const entrada = largo ? el("textarea", { rows: 2, value: c.valor || "" }) : el("input", { type: "text", value: c.valor || "" });
  entrada.dataset.clave = c.clave;
  entrada.addEventListener("input", () => { estado.editados[c.clave] = entrada.value; });
  const recordar = el("input", { type: "checkbox" });
  recordar.dataset.recordar = c.clave;
  const pie = el("div", { class: "pie" },
    ...(c.origen ? [el("span", { class: "chip", text: ORIGEN[c.origen] })] : []),
    ...(c.aviso ? [el("span", { class: "alerta", text: c.aviso })] : []),
    ...(c.origen === "contrato" ? [] : [el("label", {}, recordar, " recordar para la empresa")]));
  return el("div", { class: "campo" + (c.aviso ? " revisar" : "") + (largo ? " ancho" : "") },
    el("label", { class: "et", text: c.etiqueta }), entrada, pie);
}

function grupo(titulo, campos, abierto) {
  if (!campos.length) return null;
  const d = el("details", {}, el("summary", { text: `${titulo} (${campos.length})` }),
    el("div", { class: "grid" }, ...campos.map(filaCampo)));
  d.open = abierto;
  return d;
}

function pintarCampos() {
  const cs = estado.campos;
  const revisar = cs.filter((c) => c.aviso);
  const vacios = cs.filter((c) => !c.valor && !c.aviso);
  const contrato = cs.filter((c) => c.valor && c.origen === "contrato" && !c.aviso);
  const resto = cs.filter((c) => c.valor && c.origen !== "contrato" && !c.aviso);
  $("campos").replaceChildren(...[
    grupo("Revisar: datos que no cuadran", revisar, true),
    grupo("Leídos del contrato (comprobar)", contrato, true),
    grupo("A completar", vacios, true),
    grupo("Ya rellenados (datos de la empresa, categoría o por defecto)", resto, false),
  ].filter(Boolean));
  $("mensajeCampos").replaceChildren(el("div", { class: "nota",
    text: `${cs.length} campos en este modelo: ${vacios.length} por completar. Todos se pueden editar a mano.` }));
  $("paso3").hidden = false;
  $("paso4").hidden = false;
  $("resultado").replaceChildren();
  $("previa").hidden = true;
  $("estadoRecordar").textContent = "";
}

function valoresActuales() {
  const v = {};
  document.querySelectorAll("#campos [data-clave]").forEach((n) => { v[n.dataset.clave] = n.value; });
  return v;
}

$("btnNoProcede").addEventListener("click", () => {
  document.querySelectorAll("#campos [data-clave]").forEach((n) => {
    if (!n.value.trim()) { n.value = "No procede"; estado.editados[n.dataset.clave] = n.value; }
  });
});
$("btnMarcar").addEventListener("click", () => {
  document.querySelectorAll("#campos [data-recordar]").forEach((c) => { c.checked = true; });
});
$("btnRecordar").addEventListener("click", () => {
  const valores = valoresActuales();
  const marcados = [...document.querySelectorAll("#campos [data-recordar]")].filter((c) => c.checked).map((c) => c.dataset.recordar);
  const cif = (valores.CIF_EMPRESA || (estado.contrato || {}).CIF_EMPRESA || "").trim();
  const dest = $("estadoRecordar");
  if (!cif) { dest.textContent = "No se conoce el CIF de la empresa; no se puede guardar."; return; }
  if (!marcados.length) { dest.textContent = "Marca primero los campos que quieres recordar."; return; }
  const sel = {};
  marcados.forEach((k) => { sel[k] = valores[k]; });
  try {
    F.guardarEmpresa(cif, sel);
    dest.textContent = `Recordados ${marcados.length} campos de la empresa ${cif} en este navegador. ` +
      "Para compartirlos con tus compañeros: «Modelos y convenios» → «Datos por empresa».";
  } catch (e) { dest.textContent = e.message; }
});

/* ====================== vista previa y generación ====================== */
$("btnPrevia").addEventListener("click", async () => {
  const panel = $("previa");
  try {
    const r = await F.previsualizarAnexo($("convenio").value, $("categoria").value, valoresActuales());
    panel.replaceChildren(
      mensaje(r.faltan.length ? "aviso" : "ok", r.faltan.length
        ? `Quedan ${r.faltan.length} campos sin rellenar (en amarillo): ${r.faltan.join(", ")}` : "No falta ningún campo."),
      ...r.parrafos.map((p) => el("p", {}, ...p.map((t) =>
        el("span", { class: (t.b ? "neg " : "") + (t.falta ? "falta" : ""), text: t.t })))));
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) { panel.replaceChildren(mensaje("error", e.message)); panel.hidden = false; }
});

$("btnGenerar").addEventListener("click", async () => {
  const valores = valoresActuales();
  const vacios = Object.values(valores).filter((v) => !v.trim()).length;
  if (vacios && !confirm(`Hay ${vacios} campos vacíos. Quedarán resaltados en amarillo en el documento. ¿Generar igualmente?`)) return;
  const btn = $("btnGenerar");
  btn.disabled = true;
  try {
    const r = await F.generarAnexo($("convenio").value, $("categoria").value, valores);
    const url = URL.createObjectURL(r.blob);
    const caja = el("div", { class: "nota" },
      mensaje("ok", "Anexo generado: " + r.nombre),
      el("a", { href: url, download: r.nombre, text: "Descargar el anexo (.docx)" }));
    if (r.faltan.length) caja.append(mensaje("aviso", "Sin rellenar (resaltado en amarillo en el documento): " + r.faltan.join(", ")));
    $("resultado").replaceChildren(caja);
    descargar(r.blob, r.nombre);
  } catch (e) { $("resultado").replaceChildren(mensaje("error", e.message)); }
  finally { btn.disabled = false; }
});

$("convenio").addEventListener("change", () => { rellenarCategorias(); cargarCampos(); });
$("categoria").addEventListener("change", cargarCampos);

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
const NOMBRE_VALIDO = /^[\p{L}\p{N}][\p{L}\p{N}_ .,()\-ºª]{0,80}$/u;
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
  if (!cs.length) problemas.push({ nivel: "error", mensaje: "No hay ningún convenio en la carpeta «modelos»." });
  for (const c of cs) {
    const base = c.modelos.includes("_base.docx");
    const propios = c.modelos.filter((m) => !m.startsWith("_")).map((m) => m.replace(/\.docx$/i, ""));
    if (!base && !propios.length) problemas.push({ nivel: "error", mensaje: `${c.nombre}: no tiene ningún modelo Word.` });
    for (const cat of Object.keys(c.categorias_datos))
      if (!base && !propios.includes(cat)) problemas.push({ nivel: "error", mensaje: `${c.nombre}: la categoría «${cat}» no tiene modelo ni hay _base.docx.` });
    if (!c.categorias.length) problemas.push({ nivel: "aviso", mensaje: `${c.nombre}: no tiene categorías definidas.` });
    for (const m of c.modelos.filter((x) => !x.startsWith("_") || x === "_base.docx")) {
      try {
        const inf = await informeDeBytes(await F.bytesModelo(c.nombre, m), c.nombre);
        inf.avisos.forEach((a) => problemas.push({ nivel: "aviso", mensaje: `${c.nombre} / ${m}: ${a}` }));
      } catch (e) { problemas.push({ nivel: "error", mensaje: `${c.nombre} / ${m}: no se puede abrir (${e.message}).` }); }
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
      if (!NOMBRE_VALIDO.test(n) || n.includes("..") || n.endsWith(".")) throw new Error(`Nombre de categoría no válido: «${n}».`);
      if (categorias[n]) throw new Error(`La categoría «${n}» está repetida.`);
      categorias[n] = limpiarClaves(Object.fromEntries(adm.cols.map((col) => [col, c.datos[col] || ""])));
    }
    descargarJson(categorias, "_categorias.json");
    descargarJson(limpiarClaves(adm.kv.leer()), "_valores.json");
    dest.replaceChildren(mensaje("ok", `Descargados. Súbelos a GitHub en public/modelos/${nombre}/ (junto al Word del modelo).`));
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
