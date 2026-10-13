// Unión entre catálogo, extracción y generación. Equivalente a motor/flujo.py
// Los datos personales solo existen en memoria del navegador; lo único que se guarda en este equipo
// (localStorage) son datos de EMPRESA que la persona decide recordar.
import { cargarDocx, camposDeModelo, condicionesDeModelo, esVerdadero, rellenar, previa, empaquetar, nombreSalida } from "./docx.js";
import { extraer, leerPdf, aRegex } from "./extraccion.js";
import { avisos as avisosValidacion, cifValido, dniValido } from "./validacion.js";
import { fechaLarga, fechaCompacta } from "./util.js";

export const estado = { catalogo: null, perfiles: {}, reglas: [], camposEmpresa: [], conocidas: new Set(["DOCUMENTO", "FECHA_FIRMA", "FECHA_ENTREGA"]) };
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
  try {
    const r = await pedirJson("perfiles/_reglas.json");
    estado.reglas = r.reglas || [];
    estado.camposEmpresa = r.datos_empresa || [];
  } catch { estado.reglas = []; estado.camposEmpresa = []; }
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

/** Qué Word se usa: el propio de la categoría, el _base del convenio o el modelo común (_comun/_base.docx). */
export function archivoModelo(conv, cat) {
  const c = convenio(conv);
  if (cat && c.modelos.includes(`${cat}.docx`)) return { carpeta: c.carpeta, archivo: `${cat}.docx` };
  if (c.modelos.includes("_base.docx")) return { carpeta: c.carpeta, archivo: "_base.docx" };
  if ((estado.catalogo.modelos_comunes || []).includes("_base.docx")) return { carpeta: "_comun", archivo: "_base.docx" };
  throw new Error(`No hay modelo para «${conv} / ${cat}»: falta ${cat}.docx o _base.docx en la carpeta del convenio, o el modelo común.`);
}

export async function bytesModelo(carpeta, archivo) {
  const ruta = `modelos/${encodeURIComponent(carpeta)}/${encodeURIComponent(archivo)}`;
  if (!cacheModelos.has(ruta)) {
    const r = await fetch(ruta, { cache: "no-store" });
    if (!r.ok) throw new Error(`No se pudo cargar el modelo ${archivo} (${r.status})`);
    cacheModelos.set(ruta, new Uint8Array(await r.arrayBuffer()));
  }
  return cacheModelos.get(ruta);
}
export const olvidarModelos = () => cacheModelos.clear();

const abrirModelo = async (conv, cat) => {
  const { carpeta, archivo } = archivoModelo(conv, cat);
  return cargarDocx(await bytesModelo(carpeta, archivo));
};

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
  const toks = (s) => [...new Set(s.toLowerCase().normalize("NFKD").replace(/[^\x00-\x7F]/g, "").match(/[a-z]{4,}/g) || [])];
  const objetivo = toks(textoContrato);
  // coincidencia por raíz: «siderometalurgicas» encaja con «siderometalurgica»
  const encaja = (a, b) => a.startsWith(b.slice(0, 7)) || b.startsWith(a.slice(0, 7));
  let mejor = null, puntos = 0;
  for (const c of convenios()) {
    const p = toks(c.nombre).filter((t) => objetivo.some((o) => encaja(o, t))).length;
    if (p > puntos) { mejor = c.nombre; puntos = p; }
  }
  return mejor;
}

/** Nombre de archivo de A3: ..._B06386445.EMPRESA_45876602C.APELLIDOSNOMBRE_TIPO.pdf  -> {CIF_EMPRESA, DNI} */
export function datosDeNombreArchivo(nombre) {
  const out = {};
  const n = (nombre || "").toUpperCase();
  const cif = n.match(/(?:^|[_.\s-])([ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])(?=[_.\s-])/);
  if (cif && cifValido(cif[1])) out.CIF_EMPRESA = cif[1];
  const dni = n.match(/(?:^|[_.\s-])([XYZ]?\d{7,8}[A-Z])(?=[_.\s-])/);
  if (dni && dniValido(dni[1])) out.DNI = dni[1];
  return out;
}

function cumple(valor, patron) { return aRegex(patron).test(valor || ""); }

/** Aplica perfiles/_reglas.json: devuelve [{clave, valor, soloSiVacio, motivo}] */
export function evaluarReglas(valores, texto) {
  const out = [];
  for (const r of estado.reglas) {
    try {
      if (r.si && !Object.entries(r.si).every(([k, p]) => cumple(valores[k], p))) continue;
      if (r.si_no && Object.entries(r.si_no).some(([k, p]) => valores[k] && cumple(valores[k], p))) continue;
      if (r.si_texto && !cumple(texto, r.si_texto)) continue;
      for (const [clave, plantilla] of Object.entries(r.poner || {})) {
        const valor = String(plantilla).replace(/\{([A-Z0-9_]+)\}/g, (_, k) => valores[k] || "");
        if (valor.trim()) out.push({ clave, valor, soloSiVacio: !!r.solo_si_vacio, motivo: r.descripcion || "" });
      }
    } catch { /* una regla mal escrita no rompe la lectura */ }
  }
  return out;
}

/** Lee el PDF (bytes) y extrae los datos. No se guarda ni el PDF ni su texto. */
export async function leerContrato(bytes, { alProgreso, nombreArchivo = "" } = {}) {
  const { texto, escaneo } = await leerPdf(bytes, { alProgreso });
  const mejor = extraer(texto, estado.perfiles);
  const valores = Object.fromEntries(Object.entries(mejor.valores).filter(([, v]) => v));
  const avisosLectura = [], desdeArchivo = [];

  // El nombre del archivo de A3 lleva el CIF y el DNI: sirve de respaldo y de comprobación cruzada
  const delNombre = datosDeNombreArchivo(nombreArchivo);
  for (const [k, v] of Object.entries(delNombre)) {
    if (!valores[k]) { valores[k] = v; desdeArchivo.push(k); }
    else if (valores[k].replace(/\s/g, "") !== v) {
      avisosLectura.push(`${k === "DNI" ? "El DNI" : "El CIF"} leído en el contrato (${valores[k]}) no coincide con el del nombre del archivo (${v}). Comprueba cuál es el correcto.`);
    }
  }
  Object.assign(valores, derivados(valores));
  const deducidos = evaluarReglas(valores, mejor.texto);
  const noEncontrados = mejor.noEncontrados.filter((k) => !valores[k]);
  return { valores, deducidos, noEncontrados, desdeArchivo, avisosLectura, perfil: mejor.nombre, escaneo,
           convenio_sugerido: sugerirConvenio(valores.CONVENIO_CONTRATO), texto: mejor.texto };
}

// ---------------------------------------------------------------- formulario
export function valoresPorDefecto() {
  const hoy = fechaLarga();
  return { FECHA_HOY: hoy, FECHA_FIRMA: hoy, FECHA_ENTREGA: hoy };
}

export async function prepararCampos(conv, cat, valoresContrato = {}, editados = {}, deducidos = []) {
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
  // deducidos por reglas: nunca pisan lo leído del contrato ni lo editado a mano
  const motivo = {};
  for (const d of deducidos) {
    const k = d.clave.toUpperCase();
    if (["contrato", "editado"].includes(origen[k])) continue;
    if (d.soloSiVacio && (valor[k] || "").trim()) continue;
    valor[k] = d.valor; origen[k] = "deducido"; motivo[k] = d.motivo;
  }
  const av = avisosValidacion(valor);   // datos que no cuadran: hay que corregirlos
  const notas = {};                      // avisos informativos: no bloquean
  avisoCuatroSemanas(valor, notas);
  avisoPlazoEntrega(valor, notas);
  if (esVerdadero(valor.ES_TEMPORAL) && /indefinid/i.test(valor.DURACION || "") && !av.DURACION)
    av.DURACION = "El contrato dice «indefinida» pero has marcado que es temporal: revisa";
  const modelo = await abrirModelo(conv, cat);
  const etiquetaPorDefecto = (clave) => clave.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const ficha = (clave, etiqueta, tipo) => ({
    clave, etiqueta: etiqueta || etiquetaPorDefecto(clave), tipo,
    valor: tipo === "si_no" ? normalizarSiNo(valor[clave]) : (valor[clave] || ""),
    origen: origen[clave] || "", aviso: av[clave] || "", nota: notas[clave] || "", motivo: motivo[clave] || "",
  });
  const preguntas = condicionesDeModelo(modelo, valor).map((c) => ficha(c.clave, c.etiqueta, "si_no"));
  const campos = camposDeModelo(modelo, valor).map((c) => ficha(c.clave, c.etiqueta, "texto"));
  return [...preguntas, ...campos];
}

function normalizarSiNo(v) {
  if (v === undefined || v === null || String(v).trim() === "") return "";
  return esVerdadero(v) ? "Sí" : "No";
}

/** Art. 2.2 RD 723/2026: el capítulo II solo se aplica a relaciones de más de cuatro semanas. */
function avisoCuatroSemanas(valor, av) {
  if (!esVerdadero(valor.ES_TEMPORAL)) return;
  const a = aFecha(valor.FECHA_INICIO), b = aFecha(valor.FECHA_FIN);
  if (a && b && (b - a) / 86400000 < 28) {
    av.FECHA_FIN = "Duración de 4 semanas o menos: el art. 2.2 del RD 723/2026 no exige este documento";
  }
}

/** Art. 7 RD 723/2026: antes del inicio de la relación o, si es una modificación (conversión), como tarde el día en que surte efecto.
 *  El real decreto entró en vigor el 5 de octubre de 2026; las relaciones anteriores siguen la disposición transitoria única. */
const ENTRADA_EN_VIGOR = new Date(2026, 9, 5);
function avisoPlazoEntrega(valor, av) {
  const firma = aFecha(valor.FECHA_FIRMA);
  const conversion = esVerdadero(valor.ES_CONVERSION);
  const ref = aFecha(conversion ? valor.FECHA_CONVERSION : valor.FECHA_INICIO);
  if (!firma || !ref || firma <= ref) return;
  av.FECHA_FIRMA = ref < ENTRADA_EN_VIGOR
    ? "La relación (o la conversión) es anterior al 5/10/2026: rige la disposición transitoria única del RD 723/2026 (información a solicitud, en 30 días hábiles)"
    : conversion
      ? "Fecha posterior a la conversión: la información debía entregarse, como tarde, el día en que surtió efecto (art. 7.3 RD 723/2026)"
      : "Fecha posterior al inicio: la información debía entregarse antes del inicio de la relación (art. 7.1 RD 723/2026)";
}

function aFecha(t) {
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  let m = String(t || "").match(/(\d{1,2}) de (\p{L}+) de (\d{4})/u);
  if (m && MESES.includes(m[2].toLowerCase())) return new Date(+m[3], MESES.indexOf(m[2].toLowerCase()), +m[1]);
  m = String(t || "").match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
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
