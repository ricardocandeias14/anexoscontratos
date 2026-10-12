// OCR local (Tesseract compilado a WebAssembly). Se carga solo cuando el PDF es un escaneo.
// Todo el material (motor e idioma español) está en /vendor: no se descarga nada de internet.
function cargarScript(src) {
  return new Promise((ok, ko) => {
    if (window.Tesseract) return ok();
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => ko(new Error("No se pudo cargar el OCR local."));
    document.head.append(s);
  });
}

export async function ocrPdf(pdf, alProgreso = () => {}) {
  const base = new URL("../vendor/tesseract/", import.meta.url).href;
  await cargarScript(base + "tesseract.min.js");
  const worker = await window.Tesseract.createWorker("spa", 1, {
    workerPath: base + "worker.min.js",
    corePath: base + "core/",
    langPath: base + "lang/",
    workerBlobURL: false,
    gzip: true,
  });
  const partes = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      alProgreso(`Leyendo página ${n} de ${pdf.numPages} con OCR…`);
      const pag = await pdf.getPage(n);
      const vp = pag.getViewport({ scale: 3 });
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.floor(vp.width); lienzo.height = Math.floor(vp.height);
      await pag.render({ canvasContext: lienzo.getContext("2d"), viewport: vp }).promise;
      const r = await worker.recognize(lienzo);
      partes.push(r.data.text);
    }
  } finally { await worker.terminate(); }
  return partes.join("\n");
}
