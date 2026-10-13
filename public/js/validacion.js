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

/** CIF de sociedad (letra + 7 dígitos + control) o NIF/NIE de persona física. */
export function cifValido(valor) {
  const v = (valor || "").replace(/[\s-]/g, "").toUpperCase();
  if (/^[XYZ]?\d{7,8}[A-Z]$/.test(v)) return dniValido(v);
  const m = v.match(/^([ABCDEFGHJKLMNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (!m) return false;
  const d = m[2].split("").map(Number);
  let suma = 0;
  d.forEach((n, i) => {
    if (i % 2 === 1) suma += n;
    else { const x = n * 2; suma += Math.floor(x / 10) + (x % 10); }
  });
  const control = (10 - (suma % 10)) % 10;
  return m[3] === String(control) || m[3] === "JABCDEFGHI"[control];
}

export function avisos(valores) {
  const out = {};
  const dni = (valores.DNI || "").trim();
  if (dni && !dniValido(dni)) out.DNI = "La letra o el formato no cuadran: revisar";
  const nss = (valores.NSS || "").trim();
  if (nss && !nssValido(nss)) out.NSS = "Los dígitos de control no cuadran: revisar";
  const cif = (valores.CIF_EMPRESA || "").trim();
  if (cif && !cifValido(cif)) out.CIF_EMPRESA = "El dígito de control no cuadra: revisar";
  return out;
}
