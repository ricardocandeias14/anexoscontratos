// Comprobaciones básicas (solo avisos, nunca bloquean). Equivalente a motor/validacion.py
const LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE";

export function dniValido(valor) {
  const v = (valor || "").replace(/[\s-]/g, "").toUpperCase();
  const m = v.match(/^([XYZ]?)(\d{7,8})([A-Z])$/);
  if (!m) return false;
  let [, pref, num, letra] = m;
  num = pref ? String("XYZ".indexOf(pref)) + num : num.padStart(8, "0");
  return LETRAS_DNI[Number(num) % 23] === letra;
}

export function nssValido(valor) {
  const d = (valor || "").replace(/\D/g, "");
  if (d.length !== 12) return false;
  const prov = +d.slice(0, 2), n = +d.slice(2, 10), dc = +d.slice(10);
  const x = n < 10_000_000 ? prov * 10_000_000 + n : +d.slice(0, 10);
  return x % 97 === dc;
}

export function avisos(valores) {
  const out = {};
  const dni = (valores.DNI || "").trim();
  if (dni && !dniValido(dni)) out.DNI = "La letra o el formato no cuadran: revisar";
  const nss = (valores.NSS || "").trim();
  if (nss && !nssValido(nss)) out.NSS = "Los dígitos de control no cuadran: revisar";
  return out;
}
