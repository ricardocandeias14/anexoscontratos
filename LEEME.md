# Anexos de contrato — versión web (GitHub + Cloudflare Pages)

Web **estática**: no hay servidor ni base de datos. El PDF del contrato se lee y el Word se genera
**dentro del navegador de cada persona**; los datos del trabajador no se envían a ningún sitio.
Cloudflare solo entrega los archivos de la web (HTML, JavaScript, los modelos de Word de los convenios).

Garantía técnica verificable: `public/_headers` incluye una política de seguridad (CSP) con
`connect-src 'self'`, que impide que la página envíe datos a ninguna dirección distinta de ella misma.
(Se comprueba en el navegador: F12 → pestaña Red, al leer un contrato solo aparecen archivos de la propia web.)

## Estructura
```
build.py                  genera public/catalogo.json (lo ejecuta Cloudflare solo)
public/
  index.html, estilos.css, js/      la aplicación
  vendor/                           librerías incluidas (pdf.js, JSZip, OCR Tesseract en español)
  perfiles/                         reglas de lectura del contrato (SEPE A3/Monitor, general)
  modelos/<Convenio>/               _base.docx, <Categoría>.docx (opcional), _categorias.json, _valores.json
  empresas/<CIF>.json               datos comunes de una empresa (opcional)
  _headers                          cabeceras de seguridad de Cloudflare
```

## Puesta en marcha (una vez)
1. **GitHub**: crea un repositorio **privado** (Nuevo repositorio → Private). Descomprime este paquete y, en
   «Add file → Upload files», arrastra todo su contenido (incluida la carpeta `public`). Commit.
2. **Cloudflare**: *Workers & Pages → Create → Pages → Connect to Git* → elige el repositorio y configura:
   - Framework preset: **None**
   - Build command: **`python3 build.py`**
   - Build output directory: **`public`**
   Pulsa *Save and Deploy*. Obtendrás una dirección `algo.pages.dev`.
3. **Restringe el acceso** (muy recomendable): *Zero Trust → Access → Applications → Add → Self-hosted*,
   dominio `algo.pages.dev` (y `*.algo.pages.dev` para las versiones de prueba), política «Allow» solo para los
   correos de tus compañeros. Así solo entra quien tú autorices (plan gratuito hasta 50 usuarios).
4. No actives «Web Analytics» de Cloudflare para este sitio.

Cada vez que cambies algo en GitHub, Cloudflare vuelve a publicar solo en 1–2 minutos.

## Uso diario
Abrir la dirección → arrastrar el PDF del contrato → comprobar convenio y categoría → revisar los datos →
«Vista previa del anexo» → «Generar anexo (Word)». El .docx se descarga en la carpeta de descargas del equipo
(contiene datos personales: tratarlo como tal y borrarlo cuando proceda).

## Añadir o cambiar convenios, categorías y modelos (sin informática)
Pestaña **«Modelos y convenios»**: comprueba el Word, edita la tabla de categorías y descarga los `.json`.
Después, en GitHub: carpeta `public/modelos/<Convenio>/` → *Add file → Upload files* → arrastra el Word y los `.json`.
(Si el convenio es nuevo, escribe la ruta completa al subir y GitHub crea la carpeta.)

En el Word, cada hueco se escribe `{{CLAVE}}` o `{{CLAVE|texto de ayuda}}`. Las claves del contrato (NOMBRE, DNI, EMPRESA,
PUESTO, FECHA_INICIO…) se rellenan solas; las del convenio salen de `_categorias.json` / `_valores.json`; el resto
aparece en «A completar». Automáticas: `FECHA_HOY`, `CONVENIO`, `CATEGORIA`.
Los modelos pueden prepararse con Claude a partir del texto público del convenio (sin datos de trabajadores) y revisarse antes de subirlos.

**El repositorio solo debe contener datos de convenios y empresas. Nunca contratos, DNI ni anexos generados.**

## Datos de empresa
«Recordar para la empresa» guarda los campos marcados en **ese navegador** (localStorage). Para compartirlos:
pestaña «Modelos y convenios» → «Datos por empresa» → «Descargar para compartir» y subir el `<CIF>.json` a `public/empresas/`.

## Si un contrato no se lee bien
Las reglas están en `public/perfiles/*.json` (expresiones regulares por campo). Si A3 o Monitor cambian su formato,
se ajustan ahí. Los escaneos se leen con OCR local (más lento y menos fiable: revisar todo).

## Probar en local
`python3 build.py` y, dentro de `public`, `python3 -m http.server 8000` → http://localhost:8000
(abrir el `index.html` con doble clic no funciona: los navegadores lo bloquean).
