// Utilidades de fechas y nombres (equivalente a motor/util.py)
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "e", "van", "von", "da", "di"]);

export function fechaLarga(d = new Date()) {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function fechaCompacta(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** '12/03/2024' o '12 de MARZO de 2024' -> '12 de marzo de 2024'. Si no se entiende, la deja igual. */
export function normalizarFecha(txt) {
  const t = txt.trim();
  let m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const d = +m[1], mo = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    const f = new Date(y, mo - 1, d);
    if (f.getFullYear() === y && f.getMonth() === mo - 1 && f.getDate() === d) return fechaLarga(f);
    return t;
  }
  m = t.match(/^(\d{1,2})\s+de\s+([A-Za-záéíóúÁÉÍÓÚ]+)\s+de(?:l)?\s+(\d{4})$/);
  if (m && MESES.includes(m[2].toLowerCase())) return `${+m[1]} de ${m[2].toLowerCase()} de ${m[3]}`;
  return t;
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/** 'GARCÍA LÓPEZ MARÍA' -> 'García López María' (solo si viene todo en mayúsculas). */
export function tituloNombre(txt) {
  if (txt !== txt.toUpperCase() || txt === txt.toLowerCase()) return txt;
  return txt.toLowerCase().split(/\s+/).filter(Boolean)
    .map((w, i) => (PARTICULAS.has(w) && i > 0 ? w : cap(w))).join(" ");
}
