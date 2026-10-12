// Lectura del PDF (pdf.js, en el navegador) y extracción de datos con perfiles JSON.
// El PDF nunca sale del navegador. Equivalente a motor/extraccion.py
import { normalizarFecha, tituloNombre } from "./util.js";

const MIN_CARACTERES_TEXTO = 80; // por debajo se considera un escaneo
let pdfjs = null;

async function cargarPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

export async function abrirPdf(bytes) {
  const lib = await cargarPdfjs();
  // se pasa una copia: pdf.js se queda con el buffer
  return lib.getDocument({ data: bytes.slice(0), isEvalSupported: false, enableXfa: false }).promise;
}

/** Reconstruye líneas a partir de los fragmentos de texto de una página (orden visual). */
function lineasDePagina(items) {
  const trozos = items
    .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 10 }));
  trozos.sort((a, b) => b.y - a.y || a.x - b.x);
  const lineas = [];
  for (const t of trozos) {
    const l = lineas.find((L) => Math.abs(L.y - t.y) <= Math.max(2, t.h * 0.3));
    if (l) l.t.push(t); else lineas.push({ y: t.y, t: [t] });
  }
  lineas.sort((a, b) => b.y - a.y);
  return lineas.map((L) => {
    L.t.sort((a, b) => a.x - b.x);
    let out = "", fin = null;
    for (const t of L.t) {
      if (fin !== null && t.x - fin > 1.2 && !out.endsWith(" ") && !t.s.startsWith(" ")) out += " ";
      out += t.s;
      fin = t.x + t.w;
    }
    return out.replace(/[ \t ]+/g, " ").trim();
  });
}

export async function textoDePdf(pdf) {
  const partes = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pag = await pdf.getPage(n);
    const cont = await pag.getTextContent();
    partes.push(lineasDePagina(cont.items).join("\n"));
  }
  return partes.join("\n");
}

/** Devuelve {texto, escaneo}. Si es un escaneo usa OCR local (se carga solo en ese caso). */
export async function leerPdf(bytes, { alProgreso } = {}) {
  const pdf = await abrirPdf(bytes);
  let texto = await textoDePdf(pdf);
  let escaneo = false;
  if (texto.replace(/\s/g, "").length < MIN_CARACTERES_TEXTO) {
    escaneo = true;
    const { ocrPdf } = await import("./ocr.js");
    texto = await ocrPdf(pdf, alProgreso);
  }
  return { texto, escaneo };
}

// ----------------------------------------------------------------------------
// Perfiles (expresiones regulares escritas al estilo Python en perfiles/*.json)
// ----------------------------------------------------------------------------
const cacheRegex = new Map();

/** Convierte una expresión estilo Python (con (?i)(?m) al principio) en RegExp de JavaScript. */
export function aRegex(patron) {
  if (cacheRegex.has(patron)) return cacheRegex.get(patron);
  let flags = "u";
  let p = patron;
  const m = p.match(/^\(\?([imsx]+)\)/);
  if (m) {
    p = p.slice(m[0].length);
    for (const f of m[1]) if ("ims".includes(f) && !flags.includes(f)) flags += f;
  }
  p = p.replace(/\\w/g, "[\\p{L}\\p{N}_]");
  const re = new RegExp(p, flags);
  cacheRegex.set(patron, re);
  return re;
}

function recortar(v, chars) {
  let a = 0, b = v.length;
  while (a < b && chars.includes(v[a])) a++;
  while (b > a && chars.includes(v[b - 1])) b--;
  return v.slice(a, b);
}

export function aplicarFormato(valor, formato) {
  let v = recortar(valor.replace(/\s+/g, " ").trim(), " .,;:-\t");
  v = v.replace(/\s+([,.;:])/g, "$1");
  if (formato === "minusculas") v = v.toLowerCase();
  else if (formato === "minuscula_inicial") v = v.slice(0, 1).toLowerCase() + v.slice(1);
  else if (formato === "apellidos_coma_nombre" && v.includes(",")) {
    const i = v.indexOf(",");
    v = `${v.slice(i + 1).trim()} ${v.slice(0, i).trim()}`;
  } else if (formato === "fecha") v = normalizarFecha(v);
  else if (formato === "dni") v = v.replace(/[\s-]/g, "").toUpperCase();
  else if (formato === "nss") {
    const d = v.replace(/\D/g, "");
    v = d.length === 12 ? `${d.slice(0, 2)}/${d.slice(2, 10)}/${d.slice(10)}` : v;
  } else if (formato === "cif") v = v.replace(/[\s-]/g, "").toUpperCase();
  return v;
}

function bloqueTrabajador(texto, perfil) {
  const cfg = perfil.bloque_trabajador;
  if (!cfg) return [texto, texto];
  const ini = aRegex(cfg.inicio).exec(texto);
  if (!ini) return [texto, texto];
  const despues = texto.slice(ini.index + ini[0].length);
  const fin = cfg.fin ? aRegex(cfg.fin).exec(despues) : null;
  const final = ini.index + ini[0].length + (fin ? fin.index : despues.length);
  const bloque = texto.slice(ini.index, final);
  const empresa = texto.slice(0, ini.index) || texto;
  if (bloque.trim().length < 30) return [texto, texto];
  return [bloque, empresa];
}

function buscarCampo(spec, texto) {
  for (const patron of spec.patrones) {
    const regex = typeof patron === "object" ? patron.re : patron;
    const salida = typeof patron === "object" ? patron.salida : null;
    const m = aRegex(regex).exec(texto);
    if (!m) continue;
    let valor;
    if (salida) valor = salida.replace(/\{(\d+)\}/g, (_, n) => m[+n + 1] ?? "");
    else valor = m.slice(1).find((g) => g) ?? m[0];
    valor = aplicarFormato(valor, spec.formato || "");
    if (spec.titulo) valor = tituloNombre(valor);
    if (valor) return valor;
  }
  return "";
}

export function extraerConPerfil(texto, perfil) {
  const [trabajador, empresa] = bloqueTrabajador(texto, perfil);
  const ambitos = { trabajador, empresa, todo: texto };
  const valores = {};
  for (const [campo, spec] of Object.entries(perfil.campos)) {
    try { valores[campo] = buscarCampo(spec, ambitos[spec.en || "todo"]); }
    catch { valores[campo] = ""; }
  }
  return valores;
}

/** Prueba todos los perfiles y se queda con el que más campos rellena. */
export function extraer(texto, perfiles) {
  let mejor = null;
  for (const [nombre, perfil] of Object.entries(perfiles)) {
    const vals = extraerConPerfil(texto, perfil);
    const puntos = Object.values(vals).filter(Boolean).length;
    if (!mejor || puntos > mejor.puntos) mejor = { puntos, nombre, valores: vals };
  }
  return mejor;
}
