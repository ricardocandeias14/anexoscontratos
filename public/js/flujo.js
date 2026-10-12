// Unión entre catálogo, extracción y generación. Equivalente a motor/flujo.py
// Los datos personales solo existen en memoria del navegador; lo único que se guarda en este equipo
// (localStorage) son datos de EMPRESA que la persona decide recordar.
import { cargarDocx, camposDeModelo, rellenar, previa, empaquetar, nombreSalida } from "./docx.js";
import { extraer, leerPdf } from "./extraccion.js";
import { avisos as avisosValidacion } from "./validacion.js";
import { fechaLarga, fechaCompacta } from "./util.js";

export const estado = { catalogo: null, perfiles: {}, conocidas: new Set(["DOCUMENTO", "FECHA_FIRMA", "FECHA_ENTREGA"]) };
const cacheModelos = new Map();
const CLAVE_LOCAL = "anexos.empresas.v1";

async function pedirJson(ruta) {
  const r = await fetch(ruta, { cache: "no-store" });
  if (!r.ok) throw new Error(`No se pudo cargar ${ruta} (${r.status})`);
  return r.json();
}

export async function iniciar() {
  estado.catalogo = await pedirJson("catalogo.json");
  estado.perfiles = {};
  for (const nombre of estado.catalogo.perfiles) estado.perfiles[nombre] = await pedirJson(`perfiles/${nombre}.json`);
  estado.conocidas = new Set(["DOCUMENTO", "FECHA_FIRMA", "FECHA_ENTREGA"]);
  for (const p of Object.values(estado.perfiles)) Object.keys(p.campos).forEach((k) => estado.conocidas.add(k));
  return estado.catalogo;
}

export const convenios = () => estado.catalogo.convenios;
export const convenio = (nombre) => estado.catalogo.convenios.find((c) => c.nombre === nombre);
export const categoriasDe = (nombre) => (convenio(nombre) ? convenio(nombre).categorias : []);

function comprobarSeleccion(conv, cat) {
  if (!convenio(conv)) throw new Error(`Convenio desconocido: ${conv}`);
  if (!categoriasDe(conv).includes(cat)) throw new Error(`Categoría desconocida: ${cat}`);
}

export function datosCategoria(conv, cat) {
  const c = convenio(conv);
  const datos = {};
  for (const [k, v] of Object.entries(c.valores || {})) datos[k.toUpperCase()] = v;
  for (const [k, v] of Object.entries((c.categorias_datos || {})[cat] || {})) datos[k.toUpperCase()] = v;
  return Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== null && v !== ""));
}

export function archivoModelo(conv, cat) {
  const c = convenio(conv);
  if (cat && c.modelos.includes(`${cat}.docx`)) return `${cat}.docx`;
  if (c.modelos.includes("_base.docx")) return "_base.docx";
  throw new Error(`No hay modelo para «${conv} / ${cat}»: falta ${cat}.docx o _base.docx en la carpeta del convenio.`);
}

export async function bytesModelo(conv, archivo) {
  const ruta = `modelos/${encodeURIComponent(convenio(conv).carpeta)}/${encodeURIComponent(archivo)}`;
  if (!cacheModelos.has(ruta)) {
    const r = await fetch(ruta, { cache: "no-store" });
    if (!r.ok) throw new Error(`No se pudo cargar el modelo ${archivo} (${r.status})`);
    cacheModelos.set(ruta, new Uint8Array(await r.arrayBuffer()));
  }
  return cacheModelos.get(ruta);
}
export const olvidarModelos = () => cacheModelos.clear();

const abrirModelo = async (conv, cat) => cargarDocx(await bytesModelo(conv, archivoModelo(conv, cat)));

// ---------------------------------------------------------------- empresas
const limpiarCif = (cif) => (cif || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function leerLocal() {
  try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL) || "{}"); } catch { return {}; }
}
function escribirLocal(o) {
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(o)); return true; } catch { return false; }
}

export const upperKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toUpperCase(), v]));

/** Datos de empresa: los del repositorio (empresas/<CIF>.json) y, por encima, los guardados en este navegador. */
export function cargarEmpresa(cif) {
  const k = limpiarCif(cif);
  if (!k) return {};
  return { ...upperKeys((estado.catalogo.empresas || {})[k]), ...upperKeys(leerLocal()[k]) };
}
export function cargarEmpresaLocal(cif) { return upperKeys(leerLocal()[limpiarCif(cif)]); }
export function listarEmpresas() {
  return [...new Set([...Object.keys(estado.catalogo.empresas || {}), ...Object.keys(leerLocal())])].sort();
}

export function guardarEmpresa(cif, valores, { reemplazar = false } = {}) {
  const k = limpiarCif(cif);
  if (!k) throw new Error("CIF vacío");
  const todo = leerLocal();
  const limpios = Object.fromEntries(Object.entries(valores).filter(([, v]) => (v || "").trim()).map(([a, v]) => [a.toUpperCase(), v]));
  todo[k] = reemplazar ? limpios : { ...upperKeys(todo[k]), ...limpios };
  if (!escribirLocal(todo)) throw new Error("Este navegador no permite guardar datos locales.");
}

// ---------------------------------------------------------------- contrato
function derivados(valores) {
  const dni = valores.DNI || "";
  return dni ? { DOCUMENTO: `${"XYZ".includes(dni[0]) ? "NIE" : "DNI"} ${dni}` } : {};
}

function sugerirConvenio(textoContrato) {
  if (!textoContrato) return null;
  const toks = (s) => new Set(s.toLowerCase().normalize("NFKD").replace(/[^\x00-\x7F]/g, "").match(/[a-z]{4,}/g) || []);
  const objetivo = toks(textoContrato);
  let mejor = null, puntos = 0;
  for (const c of convenios()) {
    const p = [...toks(c.nombre)].filter((t) => objetivo.has(t)).length;
    if (p > puntos) { mejor = c.nombre; puntos = p; }
  }
  return mejor;
}

/** Lee el PDF (bytes) y extrae los datos. No se guarda ni el PDF ni su texto. */
export async function leerContrato(bytes, { alProgreso } = {}) {
  const { texto, escaneo } = await leerPdf(bytes, { alProgreso });
  const mejor = extraer(texto, estado.perfiles);
  const valores = Object.fromEntries(Object.entries(mejor.valores).filter(([, v]) => v));
  Object.assign(valores, derivados(valores));
  return { valores, perfil: mejor.nombre, escaneo, convenio_sugerido: sugerirConvenio(valores.CONVENIO_CONTRATO), texto };
}

// ---------------------------------------------------------------- formulario
export function valoresPorDefecto() {
  const hoy = fechaLarga();
  return { FECHA_HOY: hoy, FECHA_FIRMA: hoy, FECHA_ENTREGA: hoy };
}

export async function prepararCampos(conv, cat, valoresContrato = {}, editados = {}) {
  comprobarSeleccion(conv, cat);
  const capas = [
    ["defecto", valoresPorDefecto()],
    ["empresa", cargarEmpresa(valoresContrato.CIF_EMPRESA || "")],
    ["categoria", datosCategoria(conv, cat)],
    ["contrato", { ...valoresContrato, ...derivados(valoresContrato) }],
    ["editado", upperKeys(editados)],
  ];
  const valor = {}, origen = {};
  for (const [nombre, capa] of capas)
    for (const [k, v] of Object.entries(capa))
      if ((v || "").trim()) { valor[k.toUpperCase()] = v; origen[k.toUpperCase()] = nombre; }
  const av = avisosValidacion(valor);
  const modelo = await abrirModelo(conv, cat);
  return camposDeModelo(modelo).map(({ clave, etiqueta }) => ({
    clave, etiqueta: etiqueta || (clave.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())),
    valor: valor[clave] || "", origen: origen[clave] || "", aviso: av[clave] || "",
  }));
}

function valoresFinales(conv, cat, valores) {
  const vals = datosCategoria(conv, cat);
  for (const [k, v] of Object.entries(valores)) if ((v || "").trim()) vals[k.toUpperCase()] = v;
  if (!vals.FECHA_HOY) vals.FECHA_HOY = fechaLarga();
  vals.CONVENIO = conv;
  vals.CATEGORIA = cat;
  return vals;
}

export async function previsualizarAnexo(conv, cat, valores) {
  comprobarSeleccion(conv, cat);
  const modelo = await abrirModelo(conv, cat);
  const faltan = rellenar(modelo, valoresFinales(conv, cat, valores));
  return { parrafos: previa(modelo), faltan: [...faltan].sort() };
}

export async function generarAnexo(conv, cat, valores) {
  comprobarSeleccion(conv, cat);
  const modelo = await abrirModelo(conv, cat);
  const vals = valoresFinales(conv, cat, valores);
  const faltan = rellenar(modelo, vals);
  const blob = await empaquetar(modelo, `Anexo - ${conv}`);
  return { blob, nombre: nombreSalida(conv, cat, vals, fechaCompacta()), faltan: [...faltan].sort() };
}
