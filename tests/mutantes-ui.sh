#!/usr/bin/env bash
# Requirements: Bash, Node.js compatible with the installed project, python3,
# ripgrep (rg), cp, cmp, mkdir, mktemp, dirname and env; dependencies already installed.
# Offline. Originals, logs and temporary files stay under tests/.mutantes-ui/.
# Runs retain their evidence; no cleanup or writes outside this checkout.
set -euo pipefail
for requisito in node python3 rg cp cmp mkdir mktemp dirname env; do
  command -v "$requisito" >/dev/null || { echo "Falta requisito: $requisito" >&2; exit 2; }
done
cd "$(dirname "$0")/.."
repo="$PWD"
[ -f node_modules/vitest/vitest.mjs ] || { echo "Faltan las dependencias instaladas del proyecto" >&2; exit 2; }
[ ! -L tests/.mutantes-ui ] || { echo "tests/.mutantes-ui no puede ser un enlace" >&2; exit 2; }
mkdir -p "$repo/tests/.mutantes-ui"
salida="$(mktemp -d "$repo/tests/.mutantes-ui/corrida-XXXXXX")"
mkdir -p "$salida/tmp"
export TMPDIR="$salida/tmp" NODE_DISABLE_COMPILE_CACHE=1
activo=0
restaurar() {
  if [ "$activo" = 1 ]; then
    cp "$salida/$mutante.original" "$archivo"
    cmp -s "$salida/$mutante.original" "$archivo"
    activo=0
  fi
}
trap restaurar EXIT
trap 'exit 130' INT TERM
cazados=0
for mutante in punto-2-rotulo punto-3-dinero punto-5-llave v2-monto v2-liga; do
  case "$mutante" in
    punto-2-rotulo) archivo=src/ui/state.ts; prueba='sin llave usa plantilla aun si se ofrece un generador' ;;
    punto-3-dinero) archivo=src/agente/cobrar.ts; prueba='descarta borrador' ;;
    punto-5-llave) archivo=src/agente/cobrar.ts; prueba='fallo de IA no tumba HTTP y acota el motivo sin registrar la llave' ;;
    v2-monto) archivo=src/agente/cobrar.ts; prueba='descarta borrador: otro monto o moneda 650 pesos' ;;
    v2-liga) archivo=src/agente/cobrar.ts; prueba='descarta borrador: otra liga HTTPS://otro.invalid' ;;
  esac
  cp "$archivo" "$salida/$mutante.original"
  activo=1
  python3 - "$mutante" "$archivo" <<'PY'
from pathlib import Path
import sys
cambios = {
    'punto-2-rotulo': ('borrador:redactor.estado()', 'borrador:{tipo:"ia_viva",modelo:"mutante"}'),
    'punto-3-dinero': ('if (!dineroCorrecto(mensaje, cuenta, urlPago))', 'if (false)'),
    'punto-5-llave': ('return `HTTP ${error.statusCode}`;', 'return (error as Error).message;'),
    'v2-monto': ('return montos > 0 && !/[\\p{N}\\p{Sc}]/u.test(resto) && !monedaRestante && !nombresMoneda.test(resto);', 'return true;'),
    'v2-liga': ('if (!ligas || ligaIncorrecta) return false;', 'if (false) return false;'),
}
p = Path(sys.argv[2]); original = p.read_text(); antes, despues = cambios[sys.argv[1]]
if original.count(antes) != 1:
    raise SystemExit('Punto de mutación ausente o ambiguo')
p.write_text(original.replace(antes, despues))
PY
  resultado=0
  env -u GOOGLE_GENERATIVE_AI_API_KEY -u PAYPAL_CLIENT_ID -u PAYPAL_CLIENT_SECRET node node_modules/vitest/vitest.mjs run tests/ui-ia.test.ts --testNamePattern "$prueba" > "$salida/$mutante.log" 2>&1 || resultado=$?
  restaurar
  if [ "$resultado" != 1 ] || ! rg -q 'AssertionError' "$salida/$mutante.log" || ! rg -q "$prueba" "$salida/$mutante.log"; then
    echo "$mutante: NO CAZADO por una aserción (exit $resultado)"
    exit 1
  fi
  echo "$mutante: CAZADO (exit $resultado)"
  cazados=$((cazados + 1))
done
echo "$cazados/5 mutantes cazados; fuentes restauradas."
echo "Evidencia: $salida"
