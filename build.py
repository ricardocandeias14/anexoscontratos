"""Genera public/catalogo.json a partir de las carpetas de public/modelos, public/perfiles y public/empresas.

Se ejecuta solo en Cloudflare Pages (Build command:  python3 build.py), o a mano:  python3 build.py
El catálogo solo contiene nombres y textos de convenio: nunca datos de trabajadores.
"""
import json
import sys
import unicodedata
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent / "public"


def leer_json(ruta: Path, defecto):
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return defecto
    except json.JSONDecodeError as e:
        sys.exit(f"ERROR: {ruta.relative_to(PUBLIC)} está mal escrito ({e}). Corrígelo y vuelve a subirlo.")
    if not isinstance(datos, dict):
        sys.exit(f"ERROR: {ruta.relative_to(PUBLIC)} debe ser un objeto JSON {{...}}.")
    return datos


def nombre_visible(carpeta: Path) -> str:
    """Nombre que se ve en pantalla: el de _nombre.txt si existe (permite acentos), si no el de la carpeta.
    Conviene que las carpetas no lleven acentos para evitar problemas con algunos servidores."""
    f = carpeta / "_nombre.txt"
    if f.exists():
        t = f.read_text(encoding="utf-8").strip()
        if t:
            return t
    return carpeta.name


def main():
    convenios = []
    dir_modelos = PUBLIC / "modelos"
    for d in sorted(p for p in dir_modelos.iterdir() if p.is_dir() and not p.name.startswith(("_", "."))):
        categorias_datos = leer_json(d / "_categorias.json", {})
        modelos = sorted(p.name for p in d.glob("*.docx") if not p.name.startswith("~$"))
        propios = [Path(m).stem for m in modelos if not m.startswith("_")]
        categorias = list(categorias_datos) + [c for c in propios if c not in categorias_datos]
        convenios.append({
            "nombre": unicodedata.normalize("NFC", nombre_visible(d)),
            "carpeta": d.name,  # nombre exacto en disco (para pedir los archivos)
            "categorias": categorias,
            "categorias_datos": categorias_datos,
            "valores": leer_json(d / "_valores.json", {}),
            "modelos": modelos,
        })
    empresas = {}
    dir_emp = PUBLIC / "empresas"
    if dir_emp.exists():
        for f in sorted(dir_emp.glob("*.json")):
            empresas[f.stem.upper()] = leer_json(f, {})
    perfiles = sorted(p.stem for p in (PUBLIC / "perfiles").glob("*.json"))
    catalogo = {"convenios": convenios, "empresas": empresas, "perfiles": perfiles}
    (PUBLIC / "catalogo.json").write_text(json.dumps(catalogo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"catalogo.json: {len(convenios)} convenios, {len(empresas)} empresas, {len(perfiles)} perfiles")


if __name__ == "__main__":
    main()
