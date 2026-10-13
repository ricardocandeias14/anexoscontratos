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

## Uso diario (personal del despacho)
1. Arrastrar el PDF del contrato (de A3 o de Monitor).
2. Elegir la categoría profesional (el convenio se elige solo).
3. Rellenar solo lo que pida «Falta…». Los datos de la empresa se piden la primera vez y se guardan solos al generar.
4. «Generar anexo». El resto de datos se puede revisar en «Revisar o cambiar cualquier otro dato». El .docx se descarga en la carpeta de descargas del equipo
(contiene datos personales: tratarlo como tal y borrarlo cuando proceda).

## Cómo está hecho el anexo (Real Decreto 723/2026)
Un único **modelo común** (`public/modelos/_comun/_base.docx`) sirve para todos los convenios:
- **Remisiones (art. 3.3 RD 723/2026):** salario, jornada, horas extra, vacaciones, período de prueba, formación,
  extinción y modificaciones se cumplen remitiendo a artículos concretos del convenio elegido o, si no hay convenio, del
  Estatuto de los Trabajadores. Esos textos están en `_valores.json` de cada convenio (claves `REF_…` y `CONV_…`).
- **Apartados según el tipo de contrato:** temporal, fijo-discontinuo, conversión, período de prueba, ETT, trabajo a
  distancia, varios centros, turnos, distribución irregular, algoritmos, conciliación, LGTBI y trabajo en el extranjero
  solo aparecen si proceden. En pantalla son preguntas Sí/No, deducidas del contrato y corregibles.
- **Datos de empresa** (plan de igualdad, protocolo de acoso, mutua, horario, forma de pago…): se piden la primera vez y se guardan solos al generar; la siguiente vez salen rellenos
  (en ese ordenador; para compartirlos con todos: «Administración» → «Datos por empresa»).
- Avisos: duración de 4 semanas o menos (art. 2.2), entrega fuera de plazo (art. 7) y relaciones anteriores al 5/10/2026
  (disposición transitoria única).

En el Word, la sintaxis es:
- `{{CLAVE|ayuda}}`: campo.
- `{{#SI CLAVE|pregunta}}` … `{{/SI}}`, cada marca en su propio párrafo: bloque que aparece si la respuesta es Sí.
- `{{#NO CLAVE|pregunta}}` … `{{/SI}}`: bloque que aparece si la respuesta es No.
Un convenio puede tener su propio Word (`_base.docx` o `<Categoría>.docx` en su carpeta), que tiene prioridad sobre el común.

## Añadir un convenio (sin informática)
1. Pestaña «Administración» → «Preparar un convenio nuevo con Claude» → «Copiar instrucciones».
2. En un chat de Claude, pega las instrucciones y adjunta el **PDF público del convenio** (nunca contratos ni datos de trabajadores).
3. Pega la respuesta en la web → «Comprobar y cargar». Revisa artículos, cuantías y vigencia en la tabla y descarga los archivos.
4. En GitHub: `public/modelos/<Nombre sin acentos>/` → *Add file → Upload files* → arrastra `_valores.json`, `_categorias.json`
   y, si lo descargó, `_nombre.txt`. Con el modelo común no hace falta subir ningún Word.
5. «Comprobar todos los modelos» avisa si a un convenio le falta alguna remisión.

Sin convenio aplicable: elegir «Sin convenio colectivo (Estatuto de los Trabajadores)».

## Lectura del contrato
- Reglas por campo en `public/perfiles/sepe.json` (expresiones regulares). El texto se normaliza antes (números en casillas, espacios),
  y los patrones no dependen de los números de nota del modelo del SEPE.
- Si el nombre del archivo lleva el CIF y el DNI (como hace Monitor: `…_CIF.EMPRESA_DNI.NOMBRE_TIPO.pdf`), sirven de respaldo y de control: si no coinciden con el contrato, avisa.
- `public/perfiles/_reglas.json`: deducciones (tipo de contrato, respuestas por defecto, antigüedad, funciones…). Se ven como «deducido: revisar».

## Probar en local
`python3 build.py` y, dentro de `public`, `python3 -m http.server 8000` → http://localhost:8000
(abrir el `index.html` con doble clic no funciona: los navegadores lo bloquean).
