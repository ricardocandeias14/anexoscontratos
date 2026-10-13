// Relleno de modelos Word (.docx) en el navegador. Equivalente a motor/generacion.py
// Un .docx es un zip con XML: se localizan los marcadores {{CLAVE}} y se sustituyen conservando el formato.
// Requiere JSZip (vendor/jszip.min.js, cargado como script clásico).

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
export const AUTOMATICOS = ["FECHA_HOY", "CONVENIO", "CATEGORIA"];
const PAT_FUENTE = String.raw`\{\{\s*([A-Za-zÁÉÍÓÚÑáéíóúñ0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}`;
const nuevoPat = () => new RegExp(PAT_FUENTE, "g");
const FALTA = /(\[COMPLETAR: [^\]]+\])/;

// ---------------------------------------------------------------- carga / guardado
export async function cargarDocx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  if (!zip.file("word/document.xml")) throw new Error("El archivo no es un documento de Word (.docx) válido.");
  const partes = [];
  const nombres = Object.keys(zip.files).filter((n) =>
    n === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(n));
  nombres.sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)));
  for (const nombre of nombres) {
    const xml = await zip.file(nombre).async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error(`No se puede leer ${nombre}.`);
    partes.push({ nombre, doc, esCuerpo: nombre === "word/document.xml" });
  }
  return { zip, partes };
}

export async function empaquetar(modelo, titulo = "") {
  const ser = new XMLSerializer();
  for (const p of modelo.partes) {
    let xml = ser.serializeToString(p.doc);
    xml = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
    modelo.zip.file(p.nombre, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml);
  }
  const core = modelo.zip.file("docProps/core.xml");
  if (core) {
    let c = await core.async("string");
    c = c.replace(/<dc:creator>[^<]*<\/dc:creator>/, "<dc:creator></dc:creator>")
         .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, "<cp:lastModifiedBy></cp:lastModifiedBy>");
    if (titulo) {
      const t = titulo.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      c = /<dc:title>/.test(c) ? c.replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${t}</dc:title>`) : c;
    }
    modelo.zip.file("docProps/core.xml", c);
  }
  return modelo.zip.generateAsync({
    type: "blob", compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ---------------------------------------------------------------- recorrido de párrafos y runs
function dentroDe(nodo, etiqueta, hasta) {
  for (let n = nodo.parentNode; n && n !== hasta; n = n.parentNode) {
    if (n.namespaceURI === W && n.localName === etiqueta) return n;
  }
  return null;
}

/** Párrafos del documento que no están dentro de otro párrafo (cuerpo, tablas, cabeceras...). */
export function parrafosDe(doc) {
  return [...doc.getElementsByTagNameNS(W, "p")].filter((p) => !dentroDe(p, "p"));
}

function runsDe(p) {
  return [...p.getElementsByTagNameNS(W, "r")].filter((r) => dentroDe(r, "p") === p && !dentroDe(r, "del"));
}

const textoRun = (r) => [...r.childNodes]
  .filter((n) => n.namespaceURI === W && n.localName === "t").map((n) => n.textContent).join("");
const textoParrafo = (p) => runsDe(p).map(textoRun).join("");

function ponerTextoRun(r, texto) {
  const ts = [...r.childNodes].filter((n) => n.namespaceURI === W && n.localName === "t");
  const nuevo = r.ownerDocument.createElementNS(W, "w:t");
  nuevo.setAttributeNS(XML_NS, "xml:space", "preserve");
  nuevo.textContent = texto;
  if (ts.length) { r.insertBefore(nuevo, ts[0]); ts.forEach((t) => r.removeChild(t)); }
  else r.appendChild(nuevo);
}

function rPrDe(r, crear = false) {
  let rpr = [...r.childNodes].find((n) => n.namespaceURI === W && n.localName === "rPr");
  if (!rpr && crear) {
    rpr = r.ownerDocument.createElementNS(W, "w:rPr");
    r.insertBefore(rpr, r.firstChild);
  }
  return rpr;
}

/** Los campos pendientes del modelo llevan un fondo de color (sombreado); al rellenarlos se quita. */
function quitarMarca(r) {
  const rpr = rPrDe(r);
  if (!rpr) return;
  [...rpr.childNodes].filter((n) => n.namespaceURI === W && n.localName === "shd").forEach((n) => rpr.removeChild(n));
}

const DESPUES_DE_HIGHLIGHT = ["u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em",
  "lang", "eastAsianLayout", "specVanish", "oMath", "rPrChange"];

function resaltar(r) {
  const rpr = rPrDe(r, true);
  [...rpr.childNodes].filter((n) => n.namespaceURI === W && n.localName === "highlight").forEach((n) => rpr.removeChild(n));
  const h = r.ownerDocument.createElementNS(W, "w:highlight");
  h.setAttributeNS(W, "w:val", "yellow");
  const sig = [...rpr.childNodes].find((n) => n.namespaceURI === W && DESPUES_DE_HIGHLIGHT.includes(n.localName));
  rpr.insertBefore(h, sig || null);
}

const esNegrita = (r) => {
  const rpr = rPrDe(r);
  const b = rpr && [...rpr.childNodes].find((n) => n.namespaceURI === W && n.localName === "b");
  if (!b) return false;
  const v = (b.getAttributeNS(W, "val") || b.getAttribute("w:val") || "").toLowerCase();
  return !["0", "false", "off"].includes(v);
};

// ---------------------------------------------------------------- campos del modelo
const todosLosParrafos = (modelo) => modelo.partes.flatMap((p) => parrafosDe(p.doc));

// ---------------------------------------------------------------- bloques condicionales
// En el Word, un párrafo que contiene SOLO  {{#SI CLAVE|pregunta}}  abre un bloque que se mantiene si CLAVE es «Sí»;
// {{#NO CLAVE|pregunta}} abre uno que se mantiene si CLAVE es «No»; {{/SI}} lo cierra. Se pueden anidar.
const MARCA = /^\s*\{\{\s*(#SI|#NO|\/SI|\/NO|\/)\s*([A-Za-z0-9_]*)\s*(?:\|([^}]*))?\}\}\s*$/;
export const esVerdadero = (v) => /^(s[ií]|x|true|1|yes)$/i.test(String(v ?? "").trim());

function contenedores(doc) {
  const out = [];
  for (const tag of ["body", "hdr", "ftr", "tc"]) out.push(...doc.getElementsByTagNameNS(W, tag));
  return out;
}

/** Recorre los bloques. Con valores=null todo cuenta como activo (para listar o comprobar el modelo). */
function analizarBloques(doc, valores) {
  const inactivos = new Set(), marcas = new Set(), condiciones = [], errores = [];
  for (const cont of contenedores(doc)) {
    const pila = [];
    const activo = () => pila.every((b) => b.ok);
    for (const hijo of [...cont.childNodes]) {
      if (hijo.nodeType !== 1 || hijo.namespaceURI !== W) continue;
      if (hijo.localName === "p") {
        const m = MARCA.exec(textoParrafo(hijo));
        if (m) {
          marcas.add(hijo);
          if (m[1].startsWith("#")) {
            const clave = m[2].toUpperCase();
            if (!clave) errores.push("Hay un {{#SI}} sin clave.");
            if (activo()) condiciones.push({ clave, etiqueta: (m[3] || "").trim() });
            const ok = valores ? esVerdadero(valores[clave]) === (m[1] === "#SI") : true;
            pila.push({ ok, clave });
          } else if (!pila.length) errores.push("Hay un {{/SI}} de más (cierra un bloque que no se abrió).");
          else pila.pop();
          continue;
        }
      }
      if (!activo() && ["p", "tbl", "sdt"].includes(hijo.localName)) inactivos.add(hijo);
    }
    for (const b of pila) errores.push(`Falta el {{/SI}} que cierra el bloque de ${b.clave}.`);
  }
  return { inactivos, marcas, condiciones, errores };
}

function fueraDeBloque(p, a) {
  if (a.marcas.has(p)) return false;
  for (let n = p; n; n = n.parentNode) if (a.inactivos.has(n)) return false;
  return true;
}

/** Preguntas Sí/No del modelo que afectan a lo que se ve con estos valores: [{clave, etiqueta}] */
export function condicionesDeModelo(modelo, valores = null) {
  const vistas = new Map();
  for (const parte of modelo.partes) {
    for (const c of analizarBloques(parte.doc, valores).condiciones) {
      if (!vistas.has(c.clave) || (!vistas.get(c.clave).etiqueta && c.etiqueta)) vistas.set(c.clave, c);
    }
  }
  return [...vistas.values()];
}

/** Quita del documento los bloques que no proceden y los propios marcadores de bloque. */
function aplicarBloques(modelo, valores) {
  for (const parte of modelo.partes) {
    const a = analizarBloques(parte.doc, valores);
    for (const n of [...a.inactivos, ...a.marcas]) {
      const padre = n.parentNode;
      if (!padre) continue;
      padre.removeChild(n);
      // una celda de tabla no puede quedar sin párrafos
      if (padre.localName === "tc" && ![...padre.childNodes].some((x) => x.localName === "p" || x.localName === "tbl")) {
        padre.appendChild(parte.doc.createElementNS(W, "w:p"));
      }
    }
  }
}

/** Texto completo del modelo (para comprobaciones). */
export const textoModelo = (modelo) => todosLosParrafos(modelo).map(textoParrafo).join("\n");

/** Lista ordenada de {clave, etiqueta} de los marcadores, sin los automáticos.
 *  Con valores, solo los de los bloques que proceden. */
export function camposDeModelo(modelo, valores = null) {
  const orden = [], etiquetas = {};
  const parrafos = modelo.partes.flatMap((parte) => {
    const a = analizarBloques(parte.doc, valores);
    return parrafosDe(parte.doc).filter((p) => fueraDeBloque(p, a));
  });
  for (const p of parrafos) {
    for (const m of textoParrafo(p).matchAll(nuevoPat())) {
      const k = m[1].toUpperCase();
      if (AUTOMATICOS.includes(k)) continue;
      if (!(k in etiquetas)) { orden.push(k); etiquetas[k] = ""; }
      if (m[2] && !etiquetas[k]) etiquetas[k] = m[2];
    }
  }
  return orden.map((clave) => ({ clave, etiqueta: etiquetas[clave] }));
}

// ---------------------------------------------------------------- sustitución
function sustituirTexto(texto, valores, faltan) {
  return texto.replace(nuevoPat(), (_, clave) => {
    const k = clave.toUpperCase();
    const v = (valores[k] || "").trim();
    if (!v) { faltan.add(k); return `[COMPLETAR: ${k}]`; }
    return v;
  });
}

/** Marcadores partidos en varios fragmentos (Word los parte al editar). Solo se tocan los fragmentos implicados. */
function reemplazarDividido(p, valores, faltan) {
  const n = [...textoParrafo(p).matchAll(nuevoPat())].length;
  for (let i = 0; i < n; i++) {
    const runs = runsDe(p);
    const textos = runs.map(textoRun);
    const m = nuevoPat().exec(textos.join(""));
    if (!m) break;
    const ini = m.index, fin = ini + m[0].length;
    const nuevo = sustituirTexto(m[0], valores, faltan);
    let pos = 0, primero = null;
    runs.forEach((r, j) => {
      const t = textos[j], a = pos, b = pos + t.length;
      pos = b;
      if (b <= ini || a >= fin) return;
      const s = Math.max(ini, a) - a, e = Math.min(fin, b) - a;
      if (primero === null) { ponerTextoRun(r, t.slice(0, s) + nuevo + t.slice(e)); primero = r; }
      else ponerTextoRun(r, t.slice(0, s) + t.slice(e));
      quitarMarca(r);
    });
    if (primero && nuevo.includes("[COMPLETAR")) resaltar(primero);
  }
}

function reemplazarEnParrafo(p, valores, faltan) {
  if (!textoParrafo(p).includes("{{")) return;
  for (const r of runsDe(p)) {
    const t = textoRun(r);
    if (t.includes("{{")) {
      const nuevo = sustituirTexto(t, valores, faltan);
      if (nuevo !== t) ponerTextoRun(r, nuevo);
      quitarMarca(r);
      if (nuevo.includes("[COMPLETAR")) resaltar(r);
    }
  }
  if (nuevoPat().test(textoParrafo(p))) reemplazarDividido(p, valores, faltan);
}

/** Rellena el modelo (en memoria) con los valores. Devuelve el conjunto de claves sin rellenar. */
export function rellenar(modelo, valores) {
  aplicarBloques(modelo, valores);
  const faltan = new Set();
  for (const p of todosLosParrafos(modelo)) reemplazarEnParrafo(p, valores, faltan);
  return faltan;
}

/** El anexo en texto (cuerpo y tablas) para revisarlo en pantalla: [[{t, b, falta}]] */
export function previa(modelo) {
  const cuerpo = modelo.partes.find((p) => p.esCuerpo);
  const parrafos = [];
  for (const p of parrafosDe(cuerpo.doc)) {
    const trozos = [];
    for (const r of runsDe(p)) {
      for (const parte of textoRun(r).split(FALTA)) {
        if (parte) trozos.push({ t: parte, b: esNegrita(r), falta: /^\[COMPLETAR: [^\]]+\]$/.test(parte) });
      }
    }
    if (trozos.length) parrafos.push(trozos);
  }
  return parrafos;
}

// ---------------------------------------------------------------- informe de un modelo
/** Qué campos tiene un modelo, cuáles se rellenan solos y qué defectos hay (para la pestaña de modelos). */
export function informe(modelo, { categorias = {}, valores = {}, conocidas = new Set() } = {}) {
  const texto = todosLosParrafos(modelo).map(textoParrafo).join("\n");
  const avisos = [];
  const abre = (texto.match(/\{\{/g) || []).length, cierra = (texto.match(/\}\}/g) || []).length;
  if (abre !== cierra) avisos.push("Hay un «{{» sin su «}}» (o al revés): algún campo está mal escrito.");
  for (const m of texto.matchAll(/(?<!\{)\{([^{}\n]{1,60})\}(?!\})/g))
    avisos.push(`«{${m[1]}}» lleva una sola llave: los campos se escriben con dos, {{CLAVE}}.`);
  for (const m of texto.matchAll(/\{\{\s*([^}|]*?)\s*(?:\|[^}]*)?\}\}/g))
    if (!/^[#/]/.test(m[1]) && !/^[A-Za-zÁÉÍÓÚÑáéíóúñ0-9_]+$/.test(m[1]))
      avisos.push(`La clave «${m[1]}» no es válida (solo letras, números y _; sin espacios).`);
  if (texto.includes("[COMPLETAR")) avisos.push("El modelo contiene «[COMPLETAR:» de un anexo anterior; debería ser un modelo limpio.");

  for (const parte of modelo.partes) avisos.push(...analizarBloques(parte.doc, null).errores);
  const condiciones = condicionesDeModelo(modelo);
  const campos = camposDeModelo(modelo);
  const deConvenio = new Set(Object.values(categorias).flatMap((d) => Object.keys(d).map((k) => k.toUpperCase())));
  Object.keys(valores).forEach((k) => deConvenio.add(k.toUpperCase()));
  if (!campos.length) avisos.push("No se ha encontrado ningún campo {{CLAVE}}: el anexo saldría igual que el modelo.");
  return {
    campos: campos.length,
    del_contrato: campos.filter((c) => conocidas.has(c.clave)).map((c) => c.clave),
    del_convenio: campos.filter((c) => !conocidas.has(c.clave) && deConvenio.has(c.clave)).map((c) => c.clave),
    a_mano: campos.filter((c) => !conocidas.has(c.clave) && !deConvenio.has(c.clave)),
    condiciones,
    avisos,
  };
}

export function nombreSalida(convenio, categoria, valores, fechaCompacta) {
  const quien = valores.DNI || valores.NOMBRE || "sin_identificar";
  const crudo = `${convenio}_${categoria}_${quien}`.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  const limpio = crudo.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `Anexo_${limpio}_${fechaCompacta}.docx`;
}
