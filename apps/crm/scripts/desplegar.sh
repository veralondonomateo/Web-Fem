#!/usr/bin/env bash
#
# Despliega a producción, pero solo después de comprobar que lo que se va a
# subir es lo que hay de verdad en el repositorio.
#
# POR QUÉ EXISTE ESTE ARCHIVO
#
# El repo vive dentro de ~/Documents, que macOS sincroniza con iCloud. Con
# «Optimizar almacenamiento del Mac» activado, el sistema EXPULSA el contenido
# de archivos que llevan un tiempo sin tocarse y deja solo los metadatos
# (`compressed,dataless` en `ls -lO`). El tamaño y la fecha siguen siendo los
# correctos, así que:
#
#   · `git status` sale limpio,
#   · comparar tamaños contra git no delata nada,
#   · pero al LEER el archivo se obtiene vacío.
#
# El CLI de Vercel lee los archivos para subirlos, así que sube archivos en
# blanco y el build muere con errores que no tienen ningún sentido:
#
#   Type error: File '.../route.ts' is not a module
#   Error: You don't have any datasource defined in your schema.prisma
#
# Y como iCloud vacía archivos distintos según pasa el tiempo, el mismo commit
# compila a las 11 y falla a las 12. Eso costó una mañana entera de despliegues
# fallidos el 19 de agosto de 2026.
#
# Mientras el repositorio siga dentro de iCloud, despliega siempre con:
#
#   npm run deploy
#
set -euo pipefail

cd "$(dirname "$0")/../../.."      # raíz del repositorio
raiz=$(pwd)

# sha1 de un archivo vacío: la firma de «iCloud se llevó el contenido».
VACIO=da39a3ee5e6b4b0d3255bfef95601890afd80709

lista=$(mktemp); trap 'rm -f "$lista"' EXIT
git ls-files > "$lista"
total=$(wc -l < "$lista" | tr -d ' ')

echo "▸ Comprobando que los $total archivos del repositorio se lean de verdad…"

# 1) Los que macOS marca como vaciados: se le piden a iCloud. Bajarlos conserva
#    cualquier cambio sin commitear, que es justo lo que git no podría devolver.
#    (`case` dentro de $(...) rompe en el bash 3.2 de macOS, de ahí el grep.)
pedidos=0
while IFS= read -r f; do
  if ls -lO "$f" 2>/dev/null | grep -q dataless; then
    brctl download "$raiz/$f" >/dev/null 2>&1 || true
    pedidos=$((pedidos + 1))
  fi
done < "$lista"
[ "$pedidos" -gt 0 ] && echo "  · $pedidos archivo(s) estaban vaciados; se los pedí a iCloud."

# 2) La comprobación que de verdad importa: LEER cada archivo. Es lo único que
#    detecta un archivo vaciado, porque el tamaño en disco sigue mintiendo.
#
#    Solo se lee el disco, NUNCA git, mientras todo esté bien. Hacerlo al revés
#    —preguntarle a git el contenido de los 146 archivos para compararlo— colgó
#    un despliegue diez minutos: iCloud también vacía `.git`, y `git cat-file`
#    sobre un objeto expulsado se queda esperando a que iCloud lo baje. El
#    guardián contra iCloud no puede depender de algo que iCloud puede bloquear.
#
#    Un archivo que se lee vacío teniendo contenido en git es la firma
#    inconfundible: ninguno de este repositorio está vacío a propósito. Solo
#    entonces se molesta a git, y solo para ese archivo.
reparados=0; rotos=0
while IFS= read -r f; do
  [ -s "$f" ] && continue                      # tiene tamaño Y se lee: sano
  disco=$(shasum -a 1 < "$f" 2>/dev/null | cut -d' ' -f1 || true)
  [ "$disco" != "$VACIO" ] && continue

  guardado=$(git cat-file -p "HEAD:$f" 2>/dev/null | shasum -a 1 | cut -d' ' -f1 || true)
  if [ -z "$guardado" ] || [ "$guardado" = "$VACIO" ]; then
    continue                                   # git tampoco lo tiene: vacío de verdad
  fi

  echo "  · vacío en disco, reparando desde git: $f"
  git cat-file -p "HEAD:$f" > "$f.reparado" && mv -f "$f.reparado" "$f"
  if [ "$(shasum -a 1 < "$f" | cut -d' ' -f1)" = "$guardado" ]; then
    reparados=$((reparados + 1))
  else
    echo "  ✖ NO SE PUDO REPARAR: $f"
    rotos=$((rotos + 1))
  fi
done < "$lista"

if [ "$rotos" -gt 0 ]; then
  echo
  echo "✖ $rotos archivo(s) no se pueden leer ni reparar. NO se despliega: subirlos"
  echo "  así rompería producción. Revisa el estado de iCloud antes de reintentar."
  exit 1
fi

[ "$reparados" -gt 0 ] && echo "  ✓ $reparados archivo(s) reparados desde git."

echo "✓ Todo el repositorio se lee correctamente."
echo
echo "▸ Desplegando a producción…"
exec npx vercel --prod "$@"
